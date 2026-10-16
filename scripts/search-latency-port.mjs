// Benchmark process only: report the ephemeral listening port.
import http from 'node:http';
const listen=http.Server.prototype.listen;
http.Server.prototype.listen=function(...args){
  this.once('listening',()=>console.log('LATENCY_PORT '+this.address().port));
  return listen.apply(this,args);
};
