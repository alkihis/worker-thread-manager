import { WorkerOptions, Worker } from "worker_threads";

export interface WorkerSettings {
  stopOnNoTask: number;
  last_timeout?: NodeJS.Timeout;
  state: 'running' | 'stopped';
  startup_options?: WorkerOptions;
  file: string;
}

export interface ExtendedWorker extends Worker {
  online: Promise<void>;
  is_online: boolean;
}

export interface ThreadPromise<T> extends Promise<T> {
  uuid: string;
  worker: ExtendedWorker;
  stop(): void;
}
