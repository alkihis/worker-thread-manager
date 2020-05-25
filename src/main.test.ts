import { WorkerThreadManager } from '.';
import path from 'path';

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Setting limit
const JOB_COUNT = 1000;

const manager = new WorkerThreadManager;
manager.log_level = 'silly';

manager.spawn(
  /* The name of the worker pool */ 
  'task_type_1',
  /* The path to worker script */ 
  path.resolve(__dirname, 'child.test.js'), 
  /* Options */ 
  {
    /* Max 4 workers are started to distribute tasks */
    poolLength: 4, 
    /* 
      Spawn a new worker only if all started 
      workers already have 5 pending/running tasks 
    */
    spawnerThreshold: 5,
    /* 
      If a worker doesn't have a associated task 
      during {stopOnNoTask} ms, kill it 
    */
    stopOnNoTask: 1000 * 10, 
  }
);

(async () => {
  // Wait for every worker to be ready (not necessary, 
  // but assure that tasks will be immediately started when they arrive)
  await manager.init('task_type_1');
  
  let time = Date.now();

  // Start {JOB_COUNT} jobs distributed to workers.
  for (let i = 1; i <= JOB_COUNT; i++) {
    // Start a task on 'task_type_1' pool, then register it
    const task = manager.run<string>('task_type_1', i);
    task.then(data => {
      console.log(`Job #${task.uuid} says: ${data}`);
    });
  }

  // Wait for every task to end
  await manager.wait('task_type_1');

  console.log('\nPool 1 ended!');
  console.log(`Taken ${(Date.now() - time) / 1000}s.`);

  // Run one task
  await sleep(10000);
  console.log("After 10s", manager.stats('task_type_1'));

  console.log('Starting one task');
  manager.run('task_type_1', 1);
  await sleep(1000);

  console.log("After 1 task started", manager.stats('task_type_1'));
  await sleep(12000);

  console.log("After 1 task end", manager.stats('task_type_1'));
  
  console.log('Starting 25 tasks');
  for (let i = 0; i < 25; i++) 
    manager.run('task_type_1', 1);
  
  await sleep(1000);
  console.log("After 25 tasks started:", manager.stats('task_type_1'));
  
  await sleep(5000);
  console.log('After 25 tasks+ 5000ms', manager.stats('task_type_1'));

  await sleep(10000);
  console.log('After 25 tasks+ 15000ms', manager.stats('task_type_1'));
})();
