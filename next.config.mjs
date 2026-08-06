/** @type {import('next').NextConfig} */
const nextConfig = {
  // No `output: "standalone"`: the Docker image keeps the full dependency tree
  // (Prisma CLI + tsx) so the container can create and seed its own database,
  // and it serves with `next start`. Standalone output would only be dead
  // weight there, and Next warns when the two are combined.
};

export default nextConfig;
