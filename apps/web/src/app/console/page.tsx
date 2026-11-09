"use client";
import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { roleById } from "@/console/nav";
import { useRole } from "@/console/RoleContext";

/** The console has no home of its own: it opens the active role's first screen. */
export default function Home() {
  const router = useRouter();
  const { role } = useRole();
  const home = roleById(role).home;

  useEffect(() => {
    router.replace(`/console/${home}/`);
  }, [router, home]);

  return (
    <p className="text-slate">
      Opening your overview. If nothing happens,{" "}
      <Link href={`/console/${home}/`} className="underline underline-offset-4">
        go to {roleById(role).label}
      </Link>
      .
    </p>
  );
}
