import { Skeleton, AdminListSkeleton } from "@/components/admin/ui/Skeleton";

export default function AdminLoading() {
  return (
    <div>
      <div className="flex items-end justify-between">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-9.5 w-36 rounded-[10px]" />
      </div>
      <AdminListSkeleton />
    </div>
  );
}
