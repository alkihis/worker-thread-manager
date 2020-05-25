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

export interface WorkerThreadManagerOptions extends WorkerOptions { 
  stopOnNoTask?: number; 
  poolLength?: number;
  spawnerThreshold?: number;
  lazy?: boolean;
}
