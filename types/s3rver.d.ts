/**
 * s3rver ships no type declarations. Only the surface the storage adapter test
 * uses is declared here.
 */
declare module "s3rver" {
  interface S3rverOptions {
    port?: number;
    address?: string;
    silent?: boolean;
    directory: string;
    configureBuckets?: { name: string; configs: unknown[] }[];
  }
  export default class S3rver {
    constructor(options: S3rverOptions);
    run(callback: (err: Error | null) => void): void;
    close(callback: () => void): void;
  }
}
