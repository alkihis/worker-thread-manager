# worker-thread-manager

> Helps to manage tasks spread into `worker_threads` of Node.js

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

```ts
// CommonJS
const { WorkerThreadManager } = require('worker-thread-manager');

// ECMAScript
import { WorkerThreadManager } from 'worker-thread-manager';
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

## Basic usage

### Main thread

Create a pool with the `.spawn` method.
```ts
import { WorkerThreadManager } from 'worker-thread-manager';

const manager = new WorkerThreadManager;

// pool_name will be used for future usage of this pool
manager.spawn('pool_name', 'worker.js');
```
