// Credential-free transport test for the isolated Neon QA endpoint only.
// Sends only PostgreSQL SSLRequest, negotiates verified TLS, then disconnects.
// Does not authenticate, run SQL, or access production.
import net from 'node:net';
import tls from 'node:tls';
import {once} from 'node:events';

const HOST='ep-bitter-hall-ba1nrm9e.c-8.eu-central-1.aws.neon.tech';
const PORT=5432;
const SSL_REQUEST=Buffer.from([0,0,0,8,4,210,22,47]); // PostgreSQL SSLRequest
const timeoutMs=12000;

async function attest(){
  const plain=net.createConnection({host:HOST,port:PORT});
  plain.setTimeout(timeoutMs,()=>plain.destroy(new Error('qa_tls_socket_timeout')));
  try{
    await once(plain,'connect');
    const responsePromise=once(plain,'data');
    plain.write(SSL_REQUEST);
    const [response]=await responsePromise;
    if(response.length!==1||response[0]!==0x53)
      throw new Error('postgres_server_did_not_accept_ssl_request');
    const secure=tls.connect({
      socket:plain,
      servername:HOST,
      rejectUnauthorized:true,
      minVersion:'TLSv1.2',
    });
    secure.setTimeout(timeoutMs,()=>secure.destroy(new Error('qa_tls_handshake_timeout')));
    try{
      await once(secure,'secureConnect');
      if(secure.authorized!==true)throw new Error('tls_peer_not_authorized');
      const cert=secure.getPeerCertificate();
      if(!cert?.fingerprint256||tls.checkServerIdentity(HOST,cert))
        throw new Error('tls_hostname_or_certificate_not_verified');
      // Deliberate wrong-host control, without a second remote connection.
      if(!tls.checkServerIdentity('invalid-host-for-neon.invalid',cert))
        throw new Error('tls_hostname_mismatch_negative_control_failed');
      process.stdout.write(JSON.stringify({
        status:'verified',
        target:'isolated_neon_qa_tls_only',
        hostname:HOST,
        protocol:secure.getProtocol(),
        peer_certificate_fingerprint256:cert.fingerprint256,
        node_verify_hostname:true,
        wrong_hostname_rejected:true,
        authenticated_database_session:false,
      })+'\n');
    }finally{secure.destroy()}
  }finally{plain.destroy()}
}

try{await attest()}
catch(error){
  process.stderr.write('neon_qa_tls_not_certified:'+error.message+'\n');
  process.exitCode=1;
}
