import { WorkerChild } from '.';

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomBetween1And1000() {
  return Math.trunc(Math.random() * 1000);
}

// Starts the child
new WorkerChild<number, string, void>({
  async onTask(data) {
    // Wait a bit, then do complex operations...
    await sleep(randomBetween1And1000());

    let new_str = '';

    // Each task will sleep between 1 and 1000 ms, 
    // then generate 50K random numbers
    for (let i = 0; i < 50000; i++) {
      new_str += Math.random();
    }

    new_str = 'Job number ' + String(data) + ' is completed.';

    return new_str;
  },
  async onStartup() {
    // Do task to initialize the worker...
    // No task will be started while this function is running / not resolved.
    // If this function fails/rejects, so every task will fail.
  },
}).listen();
