import { WorkerThreadManager } from '.';
import path from 'path';

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Setting limit
const JOB_COUNT = 1000;

const manager = new WorkerThreadManager;

const pool = manager.spawn(
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

pool.log_level = 'debug';

(async () => {
  // Wait for every worker to be ready (not necessary, 
  // but assure that tasks will be immediately started when they arrive)
  await pool.init();
  
  let time = Date.now();

  // Start {JOB_COUNT} jobs distributed to workers.
  for (let i = 1; i <= JOB_COUNT; i++) {
    // Start a task on pool, then register it
    const task = pool.run<string>(i);
    task.then(data => {
      console.log(`Job #${task.uuid} says: ${data}`);
    });
  }

  // Wait for every task to end
  await pool.wait();

  console.log('\nPool 1 ended!');
  console.log(`Taken ${(Date.now() - time) / 1000}s.`);

  // Run one task
  await sleep(10000);
  console.log("After 10s", pool.stats());

  console.log('Starting one task');
  pool.run(1);
  await sleep(1000);

  console.log("After 1 task started", pool.stats());
  await sleep(12000);

  console.log("After 1 task end", pool.stats());
  
  console.log('Starting 25 tasks');
  for (let i = 0; i < 25; i++) 
    pool.run(1);
  
  await sleep(1000);
  console.log("After 25 tasks started:", pool.stats());
  
  await sleep(5000);
  console.log('After 25 tasks+ 5000ms', pool.stats());

  await sleep(10000);
  console.log('After 25 tasks+ 15000ms', pool.stats());
})();
