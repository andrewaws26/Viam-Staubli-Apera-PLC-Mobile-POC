// TODO: Uncomment once @clerk/nextjs is installed
// import { SignIn } from "@clerk/nextjs";
// export default function SignInPage() {
//   return (
//     <div className="flex min-h-screen items-center justify-center bg-gray-950">
//       <SignIn />
//     </div>
//   );
// }
export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950">
      <div className="text-white text-center">
        <h1 className="text-2xl font-bold mb-4">IronSight Sign In</h1>
        <p className="text-gray-400">Authentication not yet configured.</p>
        <p className="text-gray-500 text-sm mt-2">Install @clerk/nextjs and set CLERK env vars.</p>
      </div>
    </div>
  );
}
