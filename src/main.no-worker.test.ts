
// Setting limit
const JOB_COUNT = 2_000;

// Start tasks
(async () => {
  const time = Date.now();
  const jobs: Promise<string>[] = [];

  // Start {JOB_COUNT} jobs distributed to workers.
  for (let i = 1; i <= JOB_COUNT; i++) {
    // Start a task on 'task_type_1' pool, then register it
    const task = onTask(i);
    jobs.push(task);

    task.then(console.log);
  }

  await Promise.all(jobs);

  console.log('\nAll jobs have ended!');
  console.log(`Taken ${(Date.now() - time) / 1000}s.`);
})();

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomBetween1And1000() {
  return Math.trunc(Math.random() * 1000);
}

async function onTask(data: number) {
  // Wait a bit, then do complex operations...
  // await sleep(randomBetween1And1000());

  let new_str = '';

  // Each task will sleep between 1 and 1000 ms, 
  // then generate 50K random numbers
  for (let i = 0; i < 50000; i++) {
    new_str += Math.random();
  }

  new_str = 'Job number ' + String(data) + ' is completed.';

  return new_str;
}
