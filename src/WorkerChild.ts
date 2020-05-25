import { parentPort, workerData } from 'worker_threads';
import { WorkerToMessage, WorkerTaskMessage, TASK_MESSAGE, REQUEST_END_MESSAGE, WorkerFailMessage, FAIL_MESSAGE, WorkerSuccessMessage, SUCCESS_MESSAGE, WORKER_READY } from './globals';

export class WorkerChild<TaskData = any, TaskResult = any, StartupData = any> {
  protected waiting_tasks: WorkerTaskMessage<TaskData>[] = [];
  protected ready = false;
  protected init_error: any;
  protected running_tasks = new Set<string>();

  constructor(
    protected options: {
      onTask(data: TaskData): TaskResult | Promise<TaskResult>;
      onStartup?: (data?: StartupData) => any | Promise<any>;
    }
  ) {}

  isStarted(id: string) {
    return this.running_tasks.has(id);
  }

  protected async init() {
    try {
      if (this.options.onStartup) {
        await this.options.onStartup(workerData);
      }
    } catch (e) {
      // Startup error, send error
      this.init_error = e;
    }

    this.ready = true;

    // Flush tasks
    this.waiting_tasks.forEach(e => this.runTask(e));
    this.waiting_tasks = [];

    parentPort!.postMessage({
      type: WORKER_READY,
      error: this.init_error
    });
  }

  protected async runTask(data: WorkerTaskMessage<TaskData>) {
    if (!this.ready) {
      this.waiting_tasks.push(data);
      return;
    }

    this.running_tasks.add(data.id);

    // Try to complete the task
    try {
      const result = await this.options.onTask(data.data);

      if (this.isStarted(data.id)) {
        this.postEndMessage(data.id, result);
      }
    } catch (e) {
      // Failed, send error
      if (this.isStarted(data.id)) {
        this.postFailMessage(data.id, e);
      }
    }

    this.running_tasks.delete(data.id);
  }
  
  protected postFailMessage(id: string, error: any) {
    parentPort!.postMessage({
      id,
      type: FAIL_MESSAGE,
      error
    } as WorkerFailMessage);
  }

  protected postEndMessage(id: string, data: TaskResult) {
    parentPort!.postMessage({
      id,
      type: SUCCESS_MESSAGE,
      data
    } as WorkerSuccessMessage<TaskResult>);
  }

  async listen() {
    parentPort!.on('message', (data: WorkerToMessage) => {
      if (data.type === TASK_MESSAGE) {
        // Worker stat message
        this.runTask(data as WorkerTaskMessage<TaskData>);
      }
      else if (data.type === REQUEST_END_MESSAGE) {
        this.running_tasks.delete(data.id);
      }
    });

    this.init();
  }
}

export default WorkerChild;
