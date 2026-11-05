use std::fs;
fn main(){
 let s=fs::read_to_string("uee-sandbox/polyglot/results.json").expect("results");
 let count=s.matches("\"valid\": true").count();
 assert_eq!(count,2,"both products must be valid");
 assert!(s.contains("\"go_unique_images\": 2"),"Go validation missing");
 println!("RUST_EVIDENCE_CHECK_PASS {}",count);
}
