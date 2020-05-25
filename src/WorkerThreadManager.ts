import { WorkerPool } from './WorkerPool';
import { WorkerThreadManagerOptions } from './exported_globals';


export class WorkerThreadManager {
  public log_level: 'none' | 'debug' | 'silly' = 'none';

  /* PUBLIC METHODS */

  /**
   * Create a new worker pool {slug} from file {filename}.
   * 
   * Specify worker options, like pool size, worker data, etc. in {options}.
   */
  spawn(filename: string, options?: WorkerThreadManagerOptions) {  
    const pool = new WorkerPool(filename, options);
    pool.log_level = this.log_level;
    
    return pool
  }
}

export default WorkerThreadManager;
