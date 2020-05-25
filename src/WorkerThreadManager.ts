import { Worker, WorkerOptions } from 'worker_threads';
import { v4 as uuid } from 'uuid';
import { WorkerFailMessage, WorkerSuccessMessage, REQUEST_END_MESSAGE, TASK_MESSAGE, WorkerToMessage, FAIL_MESSAGE, SUCCESS_MESSAGE, WORKER_READY } from './globals';
import { ExtendedWorker, WorkerSettings, ThreadPromise } from './exported_globals';

export class WorkerThreadManager {
  protected ids_to_jobs: { [uuid: string]: ThreadPromise<any> } = {};
  protected slug_to_worker: { [slug: string]: ExtendedWorker } = {};
  
  protected worker_to_ids: Map<ExtendedWorker, Set<string>> = new Map;
  protected worker_to_slug = new Map<ExtendedWorker, string>();
  protected worker_to_settings = new Map<ExtendedWorker, WorkerSettings>();


  spawn(filename: string, slug: string, options?: WorkerOptions & { stopOnNoTask?: number }) {
    if (!slug) {
      throw new Error('Invalid slug.');
    }
  
    const stop_on_no = options?.stopOnNoTask ?? Infinity;

    if (stop_on_no < 0) {
      throw new Error('Worker stop time cannot be negative.');
    }

    const worker = this.initWorker(filename, options);

    // Register worker
    this.worker_to_settings.set(worker, { 
      stopOnNoTask: stop_on_no, 
      state: 'running', 
      startup_options: options, 
      file: filename 
    });
    this.worker_to_slug.set(worker, slug);
    this.worker_to_ids.set(worker, new Set);
    this.slug_to_worker[slug] = worker;
  }

  protected initWorker(file: string, options?: WorkerOptions) {
    const worker = new Worker(file, options) as ExtendedWorker;

    worker.is_online = false;
    worker.online = new Promise((resolve, reject) => {
      const msg_handler = (m: { type: string, error?: any }) => { 
        if (m.type === WORKER_READY) {
          worker.is_online = true; 
          // Remove event listener
          worker.off('message', msg_handler);

          if (m.error) {
            reject(m.error);
          }
          else {
            resolve(); 
          }
        }
        else {
          // A task has been started before worker is ready
          console.error('[WorkerThreadManager] A message has been received before worker has ready. This is unexcepted.');
        }
      };

      worker.on('message', msg_handler);
      worker.once('exit', () => { if (worker.is_online) { return; } reject(); });
    });

    return worker;
  }
  
  protected reviveWorker(worker: ExtendedWorker, settings: WorkerSettings) {
    const new_one = this.initWorker(settings.file, settings.startup_options);

    // Transfer all props
    this.worker_to_ids.set(new_one, this.worker_to_ids.get(worker)!);
    this.worker_to_settings.set(new_one, this.worker_to_settings.get(worker)!);
    this.worker_to_slug.set(new_one, this.worker_to_slug.get(worker)!);

    const slug = this.worker_to_slug.get(new_one)!;
    this.slug_to_worker[slug] = worker;
    this.worker_to_settings.get(new_one)!.state = 'running';
    
    return new_one;
  }

  run<T>(worker_slug: string, data: any) {
    let worker = this.slug_to_worker[worker_slug];

    if (!worker) {
      throw new Error('Undefined worker');
    }

    const settings = this.worker_to_settings.get(worker);
    if (!settings) {
      throw new Error('Undefined worker');
    }

    if (settings.state === 'stopped') {
      // Start the worker
      worker = this.reviveWorker(worker, settings);
    } 

    // Get a job ID
    const id = uuid();

    const result = (async () => {
      await worker.online;

      const job_result = await new Promise((resolve, reject) => {
        let has_ended = false;
  
        worker.on('message', (data: WorkerToMessage) => {
          if (data.id !== id) {
            return;
          }
  
          if (data.type === FAIL_MESSAGE) {
            const c = data as WorkerFailMessage;
            reject(c.error);
          }
          else if (data.type === SUCCESS_MESSAGE) {
            has_ended = true;
            const c = data as WorkerSuccessMessage<T>;
            resolve(c.data);
          }
        });
  
        worker.on('exit', code => {
          if (!has_ended) {
            reject(code);
          }
        });
      }) as T; 

      return job_result;
    })() as ThreadPromise<T>;

    this.ids_to_jobs[id] = result;
    this.worker_to_ids.get(worker)!.add(id);

    result.uuid = id;
    result.worker = worker;
    result.stop = () => {
      worker.postMessage({
        id,
        type: REQUEST_END_MESSAGE
      });
    };
    result.finally(() => {
      delete this.ids_to_jobs[id];
      const w = this.worker_to_ids.get(worker);
      if (w) {
        w.delete(id);
      }
    });

    // Start the task
    worker.postMessage({
      id,
      type: TASK_MESSAGE,
      data
    });

    return result;
  }

  get<T = any>(id: string) {
    if (id in this.ids_to_jobs) {
      return this.ids_to_jobs[id] as ThreadPromise<T>;
    }
    return undefined;
  }

  exists(id: string) {
    return id in this.ids_to_jobs;
  }

  delete(id: string) {
    if (id in this.ids_to_jobs) {
      const worker = this.ids_to_jobs[id].worker;

      const jobs = this.worker_to_ids.get(worker);
      if (!jobs) {
        delete this.ids_to_jobs[id];
        return;
      }

      jobs.delete(id);
      if (jobs.size === 0) {
        this.cleanWorker(worker);
      }
    }
  }

  /**
   * Kill a worker. Do not watch if running task are running, make sure everything is okay !
   */
  protected kill(worker: ExtendedWorker | string) {
    if (typeof worker === 'string') {
      worker = this.slug_to_worker[worker];

      if (!worker) {
        return;
      }
    }

    const settings = this.worker_to_settings.get(worker);
    if (settings) {
      settings.state = 'stopped';
    }

    worker.terminate();
  }

  /**
   * Remove every task from this worker, un-register it, and kill it.
   */
  removeWorker(worker: ExtendedWorker | string) {
    if (typeof worker === 'string') {
      worker = this.slug_to_worker[worker];

      if (!worker) {
        return;
      }
    }

    const slug = this.worker_to_slug.get(worker);
    this.worker_to_slug.delete(worker);

    const settings = this.worker_to_settings.get(worker);
    if (settings && settings.last_timeout) {
      clearTimeout(settings.last_timeout);
    }
    this.worker_to_settings.delete(worker);

    const jobs = this.worker_to_ids.get(worker);
    // Stop all running jobs of this worker
    if (jobs && jobs.size) {
      for (const job of jobs) {
        const prom = this.ids_to_jobs[job];
        prom.stop();
        
        delete this.ids_to_jobs[job];
      }
    }
    this.worker_to_ids.delete(worker);

    if (slug) {
      delete this.slug_to_worker[slug];
    }

    // Ok, all cleared.
    this.kill(worker);
  }

  protected cleanWorker(worker: ExtendedWorker) {
    const slug = this.worker_to_slug.get(worker);

    if (!slug) {
      return;
    }

    const settings = this.worker_to_settings.get(worker);

    if (!settings) {
      return;
    }

    if (settings.last_timeout) {
      clearTimeout(settings.last_timeout);
      settings.last_timeout = undefined;
    }

    if (settings.stopOnNoTask !== Infinity) {
      settings.last_timeout = setTimeout(() => {
        this.kill(worker);
      }, settings.stopOnNoTask);
    }
  }
}

export default WorkerThreadManager;
