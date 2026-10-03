import {parentPort,workerData} from 'node:worker_threads';
import {probeSource} from '../server/source-probe.mjs';
try {parentPort.postMessage({report:await probeSource(workerData)});}
catch {parentPort.postMessage({error:'audit_worker_failed'});}
