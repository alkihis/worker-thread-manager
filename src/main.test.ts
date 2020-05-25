import { WorkerThreadManager } from '.';
import path from 'path';

// Setting limit
const JOB_COUNT = 2_000;

const manager = new WorkerThreadManager;

manager.spawn(
  /* The name of the worker pool */ 
  'task_type_1',
  /* The path to worker script */ 
  path.resolve(__dirname, 'child.test.js'), 
  /* Options: Max 4 worker instances started */ 
  { poolLength: 4 }
);

// Spread tasks across workers
(async () => {
  const time = Date.now();
  const jobs: Promise<string>[] = [];

  // Start {JOB_COUNT} jobs distributed to workers.
  for (let i = 1; i <= JOB_COUNT; i++) {
    // Start a task on 'task_type_1' pool, then register it
    const task = manager.run<string>('task_type_1', i);
    jobs.push(task);

    task.then(data => {
      console.log(`Job #${task.uuid} says: ${data}`);
    });
  }

  await Promise.all(jobs);

  console.log('\nAll jobs have ended!');
  console.log(`Taken ${(Date.now() - time) / 1000}s.`);

  // Stop all workers to allow main thread to exit properly
  manager.terminate('task_type_1');
})();
