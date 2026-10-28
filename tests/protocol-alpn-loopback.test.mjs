import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createSecureServer, connect} from "node:http2";
import {once} from "node:events";

const USER_AGENT="NAWAA-PublicSourceIndexer/1.0 (+https://github.com/moealf12/Nawaa)";

// No external network: prove actual ALPN, modern TLS, HTTP/2 framing,
// certificate validation and honest bot identity against our loopback server.
// This cannot establish which source-specific rule produced a previous 403.
test("NAWAA local TLS + ALPN negotiation selects h2 with a validated certificate",{timeout:15000},async()=>{
  const dir=mkdtempSync(join(tmpdir(),"nawaa-alpn-"));
  const keyPath=join(dir,"server.key"),certPath=join(dir,"server.crt");
  let server,client;
  try{
    execFileSync("openssl",["req","-x509","-newkey","rsa:2048","-sha256","-nodes",
      "-keyout",keyPath,"-out",certPath,"-days","1","-subj","/CN=localhost",
      "-addext","subjectAltName=DNS:localhost"],{stdio:"ignore",timeout:5000});
    const key=readFileSync(keyPath),cert=readFileSync(certPath);
    const observed=[];
    server=createSecureServer({key,cert,allowHTTP1:false});
    server.on("stream",(stream,headers)=>{
      observed.push({
        method:headers[":method"],path:headers[":path"],
        userAgent:headers["user-agent"],
        alpn:stream.session.socket.alpnProtocol,
        tlsVersion:stream.session.socket.getProtocol(),
      });
      stream.respond({":status":200,"content-type":"application/json"});
      stream.end(JSON.stringify({accepted:true}));
    });
    server.listen(0,"127.0.0.1");
    await once(server,"listening");
    const port=server.address().port;
    client=connect("https://localhost:"+port,{
      ca:cert,servername:"localhost",ALPNProtocols:["h2","http/1.1"],
      lookup:(_host,options,callback)=>options?.all
        ?callback(null,[{address:"127.0.0.1",family:4}])
        :callback(null,"127.0.0.1",4),
    });
    await once(client,"connect");
    assert.equal(client.socket.authorized,true,"certificate must be trusted");
    assert.equal(client.socket.alpnProtocol,"h2","ALPN must negotiate HTTP/2");
    const request=client.request({":method":"GET",":path":"/protocol-check","user-agent":USER_AGENT});
    let status=0,body="";
    request.setEncoding("utf8");
    request.on("response",headers=>{status=headers[":status"]});
    request.on("data",chunk=>{body+=chunk});
    request.end();
    await once(request,"end");
    assert.equal(status,200);
    assert.deepEqual(JSON.parse(body),{accepted:true});
    assert.deepEqual(observed,[{
      method:"GET",path:"/protocol-check",userAgent:USER_AGENT,
      alpn:"h2",tlsVersion:client.socket.getProtocol(),
    }]);
    assert.match(client.socket.getProtocol(),/^TLSv1\.[23]$/);
    console.log("NAWAA_LOCAL_ALPN_EVIDENCE "+JSON.stringify({
      negotiatedProtocol:"h2",tlsVersion:client.socket.getProtocol(),
      certificateValidated:client.socket.authorized,
      announcedUserAgent:observed[0].userAgent,requests:observed.length,
      externalSourceAccessTested:false,
    }));
  }finally{
    client?.destroy();
    if(server?.listening)await new Promise(resolve=>server.close(resolve));
    rmSync(dir,{recursive:true,force:true});
  }
});