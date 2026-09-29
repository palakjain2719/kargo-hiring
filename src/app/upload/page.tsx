import { Uploader } from "@/components/Uploader";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default function UploadPage() {
  return (
    <>
      <PageHeader
        title="Upload & processing"
        sub="Upload the whole batch at once. Name, email and phone are separated on upload and never sent to the AI."
      />
      <Uploader />
    </>
  );
}
