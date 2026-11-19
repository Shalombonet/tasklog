// This file starts the Tasklog API server using the port from the environment.
const createApp = require("./app");

// Starts Express and prints the local address so it is easy to open and test.
function startServer() {
  const app = createApp();
  const port = Number(process.env.PORT) || 3000;

  app.listen(port, function () {
    console.info("Tasklog server is listening on port " + port);
  });
}

startServer();
