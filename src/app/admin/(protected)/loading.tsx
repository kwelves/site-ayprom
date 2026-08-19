import { Skeleton, AdminListSkeleton } from "@/components/admin/ui/Skeleton";

export default function AdminLoading() {
  return (
    <div>
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-9 w-32 rounded-md" />
      </div>
      <AdminListSkeleton />
    </div>
  );
}
