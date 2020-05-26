import { Worker, WorkerOptions, MessagePort } from 'worker_threads';
import { v4 as uuid } from 'uuid';
import { WorkerFailMessage, WorkerSuccessMessage, REQUEST_END_MESSAGE, TASK_MESSAGE, WorkerToMessage, FAIL_MESSAGE, SUCCESS_MESSAGE, WORKER_READY } from './globals';
import { ExtendedWorker, WorkerSettings, ThreadPromise, WorkerThreadManagerOptions } from './exported_globals';

interface PoolWorker {
  worker: ExtendedWorker | null;
  jobs: Set<string>;
  timeout?: NodeJS.Timeout;
  state: 'running' | 'stopped';
}

export class WorkerPool<TaskData = any, TaskResult = any> {
  protected pool: PoolWorker[] = [];
  protected settings: WorkerSettings;
  protected ids_to_jobs: { [uuid: string]: ThreadPromise<TaskResult> } = {};

  public log_level: 'none' | 'debug' | 'silly' = 'none';

  constructor(
    filename: string, 
    options?: WorkerThreadManagerOptions
  ) {
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

    this.settings = settings;

    // Create a pool of {pool_length} stopped workers
    for (let i = 0; i < pool_length; i++) {
      if (lazy) {
        this.register(null);
      }
      else {
        const worker = this.initWorker(filename, options);
        this.register(worker);
      }
    }
  }


  /* PUBLIC METHODS */

  /**
   * Force pool init for all workers of pool, then await online status for every worker.
   */
  async init() {
    const online_promises: Promise<void>[] = [];
    for (const worker of this.pool) {
      if (worker.state === 'running' && worker.worker) {
        online_promises.push(worker.worker.online);
      }
      else {
        const entity = this.initWorker(this.settings.file, this.settings.startup_options);
        worker.worker = entity;
        worker.state = 'running';
        online_promises.push(entity.online);
      }
    }

    await Promise.all(online_promises);
  }

  /**
   * Dispatch a new task to pool with task data {data}.
   * 
   * Returned {ThreadPromise} fulfills when task is finished.
   */
  run(data: TaskData, transferList?: (ArrayBuffer | MessagePort)[]) {
    // Choose the best worker (with the minimum number of tasks)
    const best_worker_index = this.findBestWorker();
    const best_worker = this.pool[best_worker_index];

    // Cancel kill task if any
    if (best_worker.timeout) {
      clearTimeout(best_worker.timeout);
      best_worker.timeout = undefined;
    }

    // Revive the worker if stopped
    if (best_worker.state === 'stopped') {
      // Start the worker
      this.reviveWorker(best_worker_index);
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
            const c = data as WorkerSuccessMessage<TaskResult>;
            resolve(c.data);
          }
        });
  
        worker.on('exit', code => {
          if (!has_ended) {
            reject(code);
          }
        });
      }) as TaskResult; 

      return job_result;
    })() as ThreadPromise<TaskResult>;

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
      this.log('silly', `Task #${id} has finished.`);

      // Remove the job reference
      delete this.ids_to_jobs[id];

      // Remove the job from worker
      best_worker.jobs.delete(id);

      // Start worker clean (do nothing if a job remains)
      this.cleanWorker(best_worker_index);
    });

    // Start the task
    this.log('silly', `Starting task #${id}.`);
    worker!.postMessage({
      id,
      type: TASK_MESSAGE,
      data
    }, transferList);

    // Return the special job promise
    return result;
  }

  /**
   * Get the task {id}
   */
  get(id: string) {
    return this.ids_to_jobs[id] as ThreadPromise<TaskResult>;
  }

  /**
   * Tells if task {id} is still started.
   */
  exists(id: string) {
    return id in this.ids_to_jobs;
  }

  /**
   * Get stats about worker pool.
   */
  stats() {
    return {
      worker_count: this.pool.length,
      active: this.pool.filter(e => e.state === 'running').length,
      stopped: this.pool.filter(e => e.state !== 'running').length,
      job_counts: this.pool.map(e => e.jobs.size),
      minimum_load: this.pool.reduce((prev, cur) => prev < cur.jobs.size ? prev : cur.jobs.size, 0),
      maximum_load: this.pool.reduce((prev, cur) => prev > cur.jobs.size ? prev : cur.jobs.size, 0),
      average_load: this.pool.reduce((sum, cur) => sum += cur.jobs.size, 0) / this.pool.length,
    };
  }

  /**
   * Remove every task from this worker pool, unregister it, and kill it.
   */
  terminate() {
    const pool = this.pool;
  
    this.unregister();  

    // Ok, all cleared.
    for (const worker of pool) {
      this.kill(worker);
    } 
  }

  /**
   * Await for every task ends, then kill every worker.
   */
  async joinAndTerminate() {
    const pool = this.pool;
  
    this.unregister(false);  

    // Get all associated task ids
    const tasks_ids = Array<string>().concat(...this.pool.map(e => [...e.jobs]));
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
   * Wait every task associated to this pool to end.
   */
  async join() {
    // Get all associated task ids
    const tasks_ids = Array<string>().concat(...this.pool.map(e => [...e.jobs]));
    // Get the task objets
    const tasks = tasks_ids.map(e => this.ids_to_jobs[e]).filter(e => e);

    // Await every task and ignore their errors
    await Promise.all(tasks.map(e => e.catch(() => {})));
  }


  /* PRIVATE METHODS */

  /**
   * Register a new worker to pool. 
   */
  protected register(worker: ExtendedWorker | null) {
    this.pool.push({
      worker,
      jobs: new Set,
      state: worker ? 'running' : 'stopped'
    });
  }

  /**
   * Suppress kill timeout and stop tasks of every worker in pool.
   */
  protected unregister(stop_tasks = true) {
    for (const worker of this.pool) {
      this.unregisterWorker(worker, stop_tasks);
    }
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
    this.log('debug', `Spawning new worker (#${id}) from '${file}'.`);

    const worker = new Worker(file, options) as ExtendedWorker;
    worker.setMaxListeners(Infinity);
    worker.uuid = id;

    worker.is_online = false;
    worker.online = new Promise((resolve, reject) => {
      const msg_handler = (m: { type: string, error?: any }) => { 
        if (m.type === WORKER_READY) {
          this.log('silly', `Worker #${id} is online.`);

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
   * Revive worker {index} from pool.
   */
  protected reviveWorker(index: number) {
    const worker = this.pool[index];
    const new_one = this.initWorker(this.settings.file, this.settings.startup_options);

    worker.worker = new_one;
    worker.state = 'running';
    
    return worker;
  }

  /**
   * Find the best appropriate worker to start a task.
   */
  protected findBestWorker() {
    let best_index = 0;
    let best_usage = Infinity;
    const spawn_threshold = this.settings.spawn_threshold;
    
    // Find started workers
    const started = this.pool.filter(e => e.state === 'running');
    const has_stopped_workers = started.length !== this.pool.length;

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

    for (let i = 0; i < this.pool.length; i++) {
      if (best_usage > this.pool[i].jobs.size) {
        best_index = i;
        best_usage = this.pool[i].jobs.size;
      }
    }

    return best_index;
  }

  /**
   * Check if worker has task. 0 task = start the worker kill process
   */
  protected cleanWorker(index: number) {
    const worker = this.pool[index];

    if (worker.timeout) {
      clearTimeout(worker.timeout);
      worker.timeout = undefined;
    }

    // If worker has no jobs, start kill process
    if (worker.jobs.size === 0 && this.settings.stop_on_no_task !== Infinity) {
      worker.timeout = setTimeout(() => {
        this.kill(worker);
      }, this.settings.stop_on_no_task);
    }
  }

  /**
   * Kill a worker. Do not watch if running task are running, make sure everything is okay !
   */
  protected kill(worker: PoolWorker) {
    worker.state = 'stopped';

    if (worker.worker) {
      this.log('debug', `Killing worker #${worker.worker.uuid}.`);
      worker.worker.terminate();
    }

    worker.worker = null;
  }

  protected log(level: 'debug' | 'silly', message: string) {
    if (this.log_level === 'none') {
      return;
    }

    if (this.log_level === 'debug' && level !== 'debug') {
      return;
    }

    console.log(`[WorkerPool] ${level}: ${message}`);
  }
}
