"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/toast";
import { GoalForm } from "@/components/goal-form";

export default function NewGoalPage() {
  const router = useRouter();
  const toast = useToast();

  return (
    <div className="space-y-4 pt-2">
      <div>
        <Link href="/goals" className="text-sm text-muted">‹ Goals</Link>
        <h1 className="text-2xl font-bold">New goal</h1>
        <p className="text-sm text-muted">Tell me what it costs and I&apos;ll work out when you can afford it.</p>
      </div>
      <GoalForm
        submitLabel="Plan it"
        onSubmit={async (g) => {
          const { data, error } = await createClient()
            .from("goals")
            .insert({
              name: g.name.trim(),
              icon: g.icon,
              target: Number(g.target),
              opening_balance: Number(g.saved || 0),
              target_date: g.target_date || null,
              priority: g.priority,
              is_custom: true,
            })
            .select("id")
            .single();
          if (error) return toast({ msg: error.message });
          router.replace(`/goals/${data.id}`);
        }}
      />
    </div>
  );
}
