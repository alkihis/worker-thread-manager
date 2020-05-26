import { WorkerOptions, Worker } from "worker_threads";

export interface WorkerSettings {
  stop_on_no_task: number;
  startup_options?: WorkerOptions;
  file: string;
  spawn_threshold: number;
}

export interface ExtendedWorker extends Worker {
  online: Promise<void>;
  is_online: boolean;
  uuid: string;
}

export interface ThreadPromise<T> extends Promise<T> {
  uuid: string;
  worker: ExtendedWorker;
  stop(): void;
}

export interface PoolStats {
  /** Number of workers in the pool */
  worker_count: number;
  /** Number of started workers */
  active: number;
  /** Number of stopped workers */
  stopped: number;
  /** Number of jobs currently handled for every worker */
  job_counts: number[];
  /** Number of jobs currently handled by the least loaded worker */
  minimum_load: number;
  /** Number of jobs currently handled by most loaded worker */
  maximum_load: number;
  /** Average number of jobs per worker */
  average_load: number;
}

export interface WorkerThreadManagerOptions extends WorkerOptions { 
  /**
   * Timeout started after worker ends every handled task.
   * 
   * If the worker gets no task during given time (in **ms**),
   * it is killed.
   * 
   * If a new task is started, this timeout is stopped.
   * 
   * Default: `Infinity` (disable autokill)
   */
  stopOnNoTask?: number; 
  /**
   * Number of start-able workers in the pool. Default: `1`
   */
  poolLength?: number;
  /**
   * Define minimum occupation in started workers needed to
   * force starting of a stopped worker.
   * 
   * Default: `0` (every time a worker is available, it will be used, stopped or not)
   */
  spawnerThreshold?: number;
  /**
   * On `WorkerPool` instancation, do not spawn workers immediately. 
   * It let workers instanciate when they receive their first task.
   * 
   * You can set this parameter to `false` to enforce worker start at the pool's creation,
   * for example if startup task is heavy and should not happen during runtime.
   * 
   * Default: `true`
   */
  lazy?: boolean;
}
