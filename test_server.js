const { startServer } = require('./dist/server.cjs'); startServer().then(({httpServer}) = console.log('Server started'); setInterval(() =, 1000); }).catch(console.error); 
