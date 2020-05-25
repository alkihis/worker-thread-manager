import { WorkerChild } from '.';

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const child = new WorkerChild<string, string, void>({
  async onTask(data) {
    // Wait a bit, then do complex operations...
    await sleep(2000);

    let new_str = '';

    for (let i = 0; i < data.length; i++) {
      new_str += data[i] + Math.random();
    }

    return new_str + '-computed';
  },
  async onStartup() {
    // Do task to initialize the worker...
    // No task will be started while this function is running / not resolved.
    // If this function fails/rejects, so every task will fail.
  },
}).listen();
