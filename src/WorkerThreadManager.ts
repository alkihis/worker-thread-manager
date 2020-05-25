import { Worker, WorkerOptions } from 'worker_threads';
import { v4 as uuid } from 'uuid';
import { WorkerFailMessage, WorkerSuccessMessage, REQUEST_END_MESSAGE, TASK_MESSAGE, WorkerToMessage, FAIL_MESSAGE, SUCCESS_MESSAGE, WORKER_READY } from './globals';
import { ExtendedWorker, WorkerSettings, ThreadPromise, WorkerThreadManagerOptions } from './exported_globals';

interface PoolData {
  pool: PoolWorker[];
  settings: WorkerSettings;
}

interface PoolWorker {
  worker: ExtendedWorker | null;
  jobs: Set<string>;
  timeout?: NodeJS.Timeout;
  state: 'running' | 'stopped';
}

export class WorkerThreadManager {
  /* PROPERTIES */

  protected ids_to_jobs: { [uuid: string]: ThreadPromise<any> } = {};
  protected slug_to_data: { [slug: string]: PoolData } = {};


  /* GETTERS */

  /**
   * Registred worker slugs.
   */
  get registred() {
    return Object.keys(this.slug_to_data);
  }


  /* PUBLIC METHODS */

  /**
   * Create a new worker pool {slug} from file {filename}.
   * 
   * Specify worker options, like pool size, worker data, etc. in {options}.
   */
  spawn(slug: string, filename: string, options?: WorkerThreadManagerOptions) {
    if (!slug) {
      throw new Error('Invalid slug.');
    }

    if (slug in this.slug_to_data) {
      throw new Error('This slug is already used (' + slug + ').');
    }
  
    const stop_on_no = options?.stopOnNoTask ?? Infinity;
    const spawn_threshold = options?.spawnerThreshold ?? 0;
    const pool_length = options?.poolLength ?? 1;
    const lazy = options?.lazy ?? true;

    if (stop_on_no < 0 || pool_length <= 0 || spawn_threshold < 0) {
      throw new Error('Worker stop time, spawn threshold or pool length cannot be negative.');
    }

    const settings: WorkerSettings = { 
      stop_on_no_task: stop_on_no, 
      startup_options: options, 
      file: filename,
      spawn_threshold
    };

    // Init slug
    this.slug_to_data[slug] = {
      pool: [],
      settings
    };

    // Create a pool of {pool_length} stopped workers
    for (let i = 0; i < pool_length; i++) {
      if (lazy) {
        this.register(null, slug);
      }
      else {
        const worker = this.initWorker(filename, options);
        this.register(worker, slug);
      }
    }
  }

  /**
   * Force pool init for all workers of pool {slug}, then await online status for every worker.
   */
  async init(slug: string) {
    const data = this.slug_to_data[slug];
    if (!data) {
      return;
    }

    const online_promises: Promise<void>[] = [];
    for (const worker of data.pool) {
      if (worker.state === 'running' && worker.worker) {
        online_promises.push(worker.worker.online);
      }
      else {
        const entity = this.initWorker(data.settings.file, data.settings.startup_options);
        worker.worker = entity;
        worker.state = 'running';
        online_promises.push(entity.online);
      }
    }

    await Promise.all(online_promises);
  }

  /**
   * Dispatch a new task to worker pool {worker_slug} with task data {data}.
   * 
   * Returned {ThreadPromise} fulfills when task is finished.
   */
  run<T>(worker_slug: string, data: any) {
    let pool = this.slug_to_data[worker_slug];

    if (!pool) {
      throw new Error('Undefined worker type');
    }

    // Choose the best worker (with the minimum number of tasks)
    const best_worker_index = this.findBestWorker(pool);
    const best_worker = pool.pool[best_worker_index];

    // Cancel kill task if any
    if (best_worker.timeout) {
      clearTimeout(best_worker.timeout);
      best_worker.timeout = undefined;
    }

    // Revive the worker if stopped
    if (best_worker.state === 'stopped') {
      // Start the worker
      this.reviveWorker(pool, best_worker_index);
    } 

    const worker = best_worker.worker!;

    // Get a job ID
    const id = uuid();

    // Start the job
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

    // Store the promise result to cache
    this.ids_to_jobs[id] = result;

    // Add the job ID to assigned worker jobs
    best_worker.jobs.add(id);

    // Init the ThreadPromise special attributes
    result.uuid = id;
    result.worker = worker;
    result.stop = () => {
      worker.postMessage({
        id,
        type: REQUEST_END_MESSAGE
      });
    };

    // Assign a listener on Promise end (whatever its status)
    result.finally(() => {
      // Remove the job reference
      delete this.ids_to_jobs[id];

      // Remove the job from worker
      best_worker.jobs.delete(id);

      // Start worker clean (do nothing if a job remains)
      this.cleanWorker(pool, best_worker_index);
    });

    // Start the task
    worker!.postMessage({
      id,
      type: TASK_MESSAGE,
      data
    });

    // Return the special job promise
    return result;
  }

  /**
   * Get the task {id}
   */
  get<T = any>(id: string) {
    return this.ids_to_jobs[id] as ThreadPromise<T>;
  }

  /**
   * Tells if task {id} is still started.
   */
  exists(id: string) {
    return id in this.ids_to_jobs;
  }

  /**
   * Get stats about worker pool {slug}.
   */
  stats(slug: string) {
    const data = this.slug_to_data[slug];
    if (!data) {
      return;
    }

    return {
      worker_count: data.pool.length,
      active: data.pool.filter(e => e.state === 'running').length,
      stopped: data.pool.filter(e => e.state !== 'running').length,
      job_counts: data.pool.map(e => e.jobs.size),
      minimum_load: data.pool.reduce((prev, cur) => prev < cur.jobs.size ? prev : cur.jobs.size, 0),
      maximum_load: data.pool.reduce((prev, cur) => prev > cur.jobs.size ? prev : cur.jobs.size, 0),
      average_load: data.pool.reduce((sum, cur) => sum += cur.jobs.size, 0) / data.pool.length,
    };
  }

  /**
   * Remove every task from this worker type, unregister it, and kill it.
   */
  terminate(slug: string) {
    const data = this.slug_to_data[slug];
    if (!data) {
      return;
    }

    const pool = data.pool;
  
    this.unregister(slug);  

    // Ok, all cleared.
    for (const worker of pool) {
      this.kill(worker);
    } 
  }

  /**
   * Remove a worker type, but do not stop its tasks immediately.
   * After its tasks ends, worker pool is cleared and killed.
   */
  async waitAndTerminate(slug: string) {
    const data = this.slug_to_data[slug];
    if (!data) {
      return;
    }

    const pool = data.pool;

    // Timeout after task end: 1ms
    data.settings.stop_on_no_task = 1;
  
    this.unregister(slug, false);  

    // Get all associated task ids
    const tasks_ids = Array<string>().concat(...data.pool.map(e => [...e.jobs]));
    // Get the task objets
    const tasks = tasks_ids.map(e => this.ids_to_jobs[e]).filter(e => e);

    // Await every task and ignore their errors
    await Promise.all(tasks.map(e => e.catch(() => {})));

    // Ok, all cleared. Kill them.
    for (const worker of pool) {
      this.kill(worker);
    } 
  }

  /**
   * Wait every task associated to this worker pool to end.
   */
  async wait(slug: string) {
    const data = this.slug_to_data[slug];
    if (!data) {
      return;
    }

    // Get all associated task ids
    const tasks_ids = Array<string>().concat(...data.pool.map(e => [...e.jobs]));
    // Get the task objets
    const tasks = tasks_ids.map(e => this.ids_to_jobs[e]).filter(e => e);

    // Await every task and ignore their errors
    await Promise.all(tasks.map(e => e.catch(() => {})));
  }


  /* PRIVATE METHODS */

  /**
   * Register a worker to a pool. 
   */
  protected register(worker: ExtendedWorker | null, slug: string) {
    this.slug_to_data[slug].pool.push({
      worker,
      jobs: new Set,
      state: worker ? 'running' : 'stopped'
    });
  }

  /**
   * Remove every worker from a pool, suppress their kill timeout and stop their tasks.
   */
  protected unregister(slug: string, stop_tasks = true) {
    const data = this.slug_to_data[slug];

    if (!data) {
      return;
    }

    for (const worker of data.pool) {
      this.unregisterWorker(worker, stop_tasks);
    }

    delete this.slug_to_data[slug];
  }

  /**
   * Suppress kill timeout and stop jobs of this worker.
   */
  protected unregisterWorker(worker: PoolWorker, stop_tasks = true) {
    if (worker.timeout) {
      clearTimeout(worker.timeout);
      worker.timeout = undefined;
    }

    // Stop all running jobs of this worker
    if (stop_tasks) {
      for (const id of worker.jobs) {
        const job = this.ids_to_jobs[id];
  
        if (!job) continue;
  
        job.stop();
        delete this.ids_to_jobs[id];
      }
  
      worker.jobs.clear();
    }
  }

  /**
   * Create a Node.js Worker instance and attach a listener to worker resolution
   * in order to make it a `ExtendedWorker`.
   */
  protected initWorker(file: string, options?: WorkerOptions) {
    const id = uuid();
    console.log(`[WorkerThreadManager] Spawning new worker (#${id}) from '${file}'.`);

    const worker = new Worker(file, options) as ExtendedWorker;
    worker.setMaxListeners(Infinity);

    worker.is_online = false;
    worker.online = new Promise((resolve, reject) => {
      const msg_handler = (m: { type: string, error?: any }) => { 
        if (m.type === WORKER_READY) {
          console.log(`[WorkerThreadManager] Worker #${id} is online.`);

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
  
  /**
   * Revive worker {index} from pool {data}.
   */
  protected reviveWorker(data: PoolData, index: number) {
    const worker = data.pool[index];
    const new_one = this.initWorker(data.settings.file, data.settings.startup_options);

    worker.worker = new_one;
    worker.state = 'running';
    
    return worker;
  }

  /**
   * Find the best appropriate worker to start a task in {data}.
   */
  protected findBestWorker(data: PoolData) {
    let best_index = 0;
    let best_usage = Infinity;
    const spawn_threshold = data.settings.spawn_threshold;
    
    // Find started workers
    const started = data.pool.filter(e => e.state === 'running');
    const has_stopped_workers = started.length !== data.pool.length;

    if (spawn_threshold && started.length) {
      for (let i = 0; i < started.length; i++) {
        const usage = started[i].jobs.size;

        if (usage >= spawn_threshold && has_stopped_workers) {
          continue;
        }

        if (best_usage > usage) {
          best_index = i;
          best_usage = usage;
        }
      }

      // A worker with usage < spawn_threshold found
      if (best_usage !== Infinity) {
        return best_index
      }
    }

    // Find the best worker (usually stopped ones)
    best_index = 0;
    best_usage = Infinity;

    for (let i = 0; i < data.pool.length; i++) {
      if (best_usage > data.pool[i].jobs.size) {
        best_index = i;
        best_usage = data.pool[i].jobs.size;
      }
    }

    return best_index;
  }

  /**
   * Check if worker has task. 0 task = start the worker kill process
   */
  protected cleanWorker(data: PoolData, index: number) {
    const worker = data.pool[index];

    if (worker.timeout) {
      clearTimeout(worker.timeout);
      worker.timeout = undefined;
    }

    // If worker has no jobs, start kill process
    if (worker.jobs.size === 0 && data.settings.stop_on_no_task !== Infinity) {
      worker.timeout = setTimeout(() => {
        this.kill(worker);
      }, data.settings.stop_on_no_task);
    }
  }

  /**
   * Kill a worker. Do not watch if running task are running, make sure everything is okay !
   */
  protected kill(worker: PoolWorker) {
    worker.state = 'stopped';

    if (worker.worker)
      worker.worker.terminate();

    worker.worker = null;
  }
}

export default WorkerThreadManager;
