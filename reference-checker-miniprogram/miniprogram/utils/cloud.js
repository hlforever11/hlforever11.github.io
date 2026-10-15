function withTimeout(operation, timeout = 15000, message = "云服务响应超时，请稍后重试。") {
  let timer;
  return Promise.race([
    Promise.resolve().then(operation),
    new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeout);
    })
  ]).finally(() => clearTimeout(timer));
}
module.exports = { withTimeout };
