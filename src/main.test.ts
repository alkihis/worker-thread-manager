import { WorkerThreadManager } from '.';

const manager = new WorkerThreadManager;

manager.spawn('child.test.js', 'task_1', )
