# worker-thread-manager

> Helps to manage pool of tasks into `worker_threads` of Node.js

**This package requires `worker_threads` support, bundled with Node 10 with `--experimental-worker` flag or with Node 12 natively.**

## Getting started

Install the package using npm or yarn.

```bash
npm i worker-thread-manager
# or
yarn add worker-thread-manager
```

You can import the package using CommonJS or ECMAScript native imports.
The whole package is written in TypeScript and provide type definitions.

This documentation will use TypeScript typings, remove them in order to use native JavaScript.

```ts
// CommonJS
const { WorkerThreadManager } = require('worker-thread-manager');

// ECMAScript
import { WorkerThreadManager } from 'worker-thread-manager';
// or (this is the default export)
import WorkerThreadManager from 'worker-thread-manager';
```

## Features

Node.js's `worker_threads` package allow users to spread tasks across multiple threads 
to do intensive jobs without blocking its event loop.

Unfortunatly, defined API provides only a few tools to communicate through main thread and its children, all event based.

This package handles the boilerplate introduced by this biais of communication and wraps tasks into `Promise`s objects.

- Create multiple pools of workers to distribute your tasks at will
- Auto-kill children processes that are not used after a certain period of time to save memory
- With one call, dispatch a task to a pool of worker by providing custom data, and await the result
- Easily await end of a group of tasks
- Workers are only spawned when necessary to avoid useless memory usage

## Limitations

Communications between main thread and workers [are limited](https://nodejs.org/api/worker_threads.html#worker_threads_port_postmessage_value_transferlist).

Values sent and received by workers are limited to supported values in [HTML structured clone algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm).

In particular, the significant differences to JSON are:

- Value may contain circular references.
- Value may contain instances of builtin JS types such as `RegExp`s, `BigInt`s, `Map`s, `Set`s, etc.
- Value may contain typed arrays, both using `ArrayBuffer`s and `SharedArrayBuffer`s.
- Value may contain `WebAssembly.Module` instances.
- Value may ***not*** contain native (C++-backed) objects other than `MessagePort`s.

Those limitations apply to initial worker values (`workerData` option), 
input values (first parameter of `.run()` method of `WorkerPool`),
and results of workers (return type of `WorkerChild`'s `onTask` handler).

## Basic usage

### Main thread

Create a pool with the `.spawn()` method and start a job with `.run()`.

The best worker to use (the less used) will automatically be selected in order to run new jobs. You can adjust the threshold needed to force spawning of a new worker instead of using a started one with `spawnerThreshold` option. 

You can await a single job by awaiting result of `.run()`, or await all the started job in the worker pool by using `.join()` method.

```ts
// main.js / main.ts
import WorkerThreadManager, { WorkerPool } from 'worker-thread-manager';

// Create the pool that take items of type number in input,
// and returns a result of type string.
const worker_pool = WorkerThreadManager.spawn<number, string>(
  // Filename to worker JS file
  'worker.js',
  {
    // Maximum of 4 instances of worker.js (default: 1)
    poolLength: 4,
    // Before instanciate a new worker, wait for every
    // started worker to have 5 tasks currently running at least
    // (default: 0 (aggressive spawning if a worker is unused))
    spawnerThreshold: 5,
  }
);

// In order to use await, 
// wrap script into a async function
main(worker_pool);

async function main(pool: WorkerPool) {
  // Start 10,000 jobs distributed to pool.
  for (let i = 1; i <= 10_000; i++) {
    // Start a task on pool, then register it
    const task = pool.run(i);

    task.then(data => {
      console.log(`Job #${task.uuid} says: ${data}`);
    });
  }

  // Await for every job to end
  await pool.join();
}
```

### Child process

The child must import `WorkerChild` from the package, instanciate it and listen for events.

```ts
// worker.js / worker.ts
import { WorkerChild } from 'worker-thread-manager';

async function onTask(data: number, job_id: string) {
  // This function must return a string, as defined in WorkerChild types.
  let current_number = 0;

  // Each task will sleep between 1 and 1000 ms, 
  // then generate 50K random numbers
  for (let i = 0; i < 50_000; i++) {
    current_number += Math.random();
  }

  return `Job ${job_id} finished well with number ${current_number}.`;
}

function onStartup() {
  // This function is executed when worker starts.
  // You can return a Promise, it will be awaited.
  // As worker can be automatically killed, this function 
  // can be executed multiple times.
}

// Starts the child
// It take number as input, returns a string,
// and take nothing as startup argument (workerData is empty).
new WorkerChild<number, string, void>({
  onTask: onTask,
  onStartup: onStartup,
}).listen();
```

## Advanced usage

### Options of `WorkerThreadManager.spawn` method

First parameter is script filename. Prefer using absolute filename, it's more safe. If you're using TypeScript, this path must be the *compiled* version of script, always the JavaScript version (unless you're using `ts-node`)!

Second parameter is a optional `WorkerThreadManagerOptions` object, that extends the native `WorkerOptions` object from `worker_threads` module ([see this](https://nodejs.org/api/worker_threads.html#worker_threads_new_worker_filename_options)).

Every following parameter is optional.

- stopOnNoTask: `number`. Timeout started after worker ends every handled task.
  If the worker gets no task during given time (in **ms**), it is killed.
  If a new task is started, this timeout is stopped. 
  Default: `Infinity` (disable autokill).

- poolLength: `number`. Number of start-able workers in the pool. Default: `1`.

- spawnerThreshold: `number`. Define minimum occupation in started workers needed to force starting of a stopped worker. Default: `0` (every time a worker is available, it will be used, stopped or not).

- lazy: `boolean`. On `WorkerPool` instancation, do not spawn workers immediately. It let workers instanciate when they receive their first task. You can set this parameter to `false` to enforce worker start at the pool's creation, for example if startup task is heavy and should not happen during runtime. Default: `true`.

- workerData: `any`. Data to give to worker at instanciation. It will be directly given in parameter of `onStartup` parameter function of `WorkerChild`.

- eval: `boolean`. If `true`, interpret the first argument (initially, filename) as a script that is executed once the worker is online.

### Options of `WorkerChild` constructor


