export const STOP_MESSAGE = '____worker_stop';
export const TASK_MESSAGE = '____worker_newtask';
export const SUCCESS_MESSAGE = '____worker_success_end';
export const FAIL_MESSAGE = '____worker_failed_end';
export const REQUEST_END_MESSAGE = '____worker_task_request_end';
export const WORKER_READY = '____worker_ready';
export const WORKER_INFO_MESSAGE = '____worker_info';

export interface WorkerToMessage {
  id: string;
  type: string;
}

export interface WorkerTaskMessage<T> extends WorkerToMessage {
  type: typeof TASK_MESSAGE;
  data: T;
}

export interface WorkerSuccessMessage<T> extends WorkerToMessage {
  type: typeof SUCCESS_MESSAGE;
  data: T;
}

export interface WorkerFailMessage extends WorkerToMessage {
  type: typeof FAIL_MESSAGE;
  error: any;
}

export interface WorkerInfoMessage {
  type: typeof WORKER_INFO_MESSAGE;
  data: any;
}
