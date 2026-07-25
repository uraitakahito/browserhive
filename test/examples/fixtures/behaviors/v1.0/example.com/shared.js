class {
  static id = "example.com:shared";
  static isMatch() {
    return true;
  }
  async *run(ctx) {
    yield ctx.getState("shared", "n");
  }
}
