onmessage = (event) => {
  // event.data : {scope: [[name, exports]], filename: string}
  event.data.scope.forEach(element => {
    let [name, exports] = element;
    // set global variables to bind the imported instances
    self[name] = Promise.resolve(exports);
  });

  let fname = event.data.filename;
  // Set `id' so that async_index knows where the tests are running from.
  self.id = fname.replace(/^.*[\\/]/, '');

  importScripts("testharness.js", "async_index.js");

  // Fix path resolution: the filename might contain 'out/' or similar if built into an output directory,
  // but when running the test server from that directory, the path should be relative to the root.
  // Instead of prepending '/', we can just strip any 'out/' prefix or find the basename.
  // Actually, the main HTML page is at the root of the server, and the worker is in /js/harness/.
  // So the root of the server is two levels up from the worker.
  // Let's just use absolute path from the server root by cleaning up the fname.
  let scriptPath = "/" + fname;
  if (scriptPath.startsWith("/out/")) {
      scriptPath = scriptPath.substring(4);
  }

  // Execute the importScripts in the current chain, but don't circularly reassign chain
  // before importScripts runs.
  let original_chain = chain;
  chain = original_chain.then(_ => {
    try {
      console.log(`Worker ${fname} starting importScripts(${scriptPath})`);
      // We must reset chain to the original resolved state BEFORE importScripts
      // adds new promises, otherwise they will wait on the Promise we are currently inside!
      chain = Promise.resolve();
      importScripts(scriptPath);
      console.log(`Worker ${fname} finished importScripts`);
    } catch (e) {
      console.log(`Worker ${fname} caught error during importScripts: ${e}`);
      throw new Error("importScripts failed for " + scriptPath + ": " + e);
    }
    console.log(`Worker ${fname} returning chain`);
    return chain;
  }).then(
    _ => {
      console.log(`Worker ${fname} posted done`);
      done();
      postMessage({type: "done"});
    },
    reason => {
      console.log(`Worker ${fname} failed due to ` + reason)
      done();
      postMessage({type: "failed", loc: String(reason), name: fname})
    }
  );
};
