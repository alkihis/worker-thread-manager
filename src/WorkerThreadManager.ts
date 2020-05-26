import { WorkerPool } from './WorkerPool';
import { WorkerThreadManagerOptions } from './exported_globals';

export const WorkerThreadManager = new class WorkerThreadManager {
  public log_level: 'none' | 'debug' | 'silly' = 'none';

  /* PUBLIC METHODS */

  /**
   * Create a new worker pool {slug} from file {filename}.
   * 
   * Specify worker options, like pool size, worker data, etc. in {options}.
   */
  spawn<TaskData = any, TaskResult = any>(
    filename: string, 
    options?: WorkerThreadManagerOptions
  ) {  
    const pool = new WorkerPool<TaskData, TaskResult>(filename, options);
    pool.log_level = this.log_level;

    return pool;
  }
}();

export default WorkerThreadManager;
