class {
  static id = "www.example.com:probe";
  static isMatch() {
    return true;
  }
  async *run(ctx) {
    yield ctx.getState("probe", "n");
  }
}
