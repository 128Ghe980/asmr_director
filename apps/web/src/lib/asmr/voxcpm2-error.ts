export class VoxCpm2Error extends Error {
  constructor(message: string, public readonly statusCode = 502) {
    super(message);
    this.name = "VoxCpm2Error";
  }
}
