import { Container } from "@/components/ui/Container";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";

export default function PublicLoading() {
  return (
    <Container className="py-12">
      <LoadingSkeleton />
    </Container>
  );
}
