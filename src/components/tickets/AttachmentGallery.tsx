import Image from "next/image";
import { Camera } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import RelativeTime from "@/components/tickets/RelativeTime";

export interface AttachmentView {
  id: string;
  caption: string;
  createdAt: Date;
}

/**
 * Screenshots an agent captured while working the ticket. They sit above the
 * timeline on purpose: when a run is paused for approval, this is what lets a
 * reviewer see the proposed UI change before deciding.
 */
export default function AttachmentGallery({ attachments }: { attachments: AttachmentView[] }) {
  if (attachments.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-[15px]">
          <Camera size={16} className="text-primary-strong" />
          Screenshots ({attachments.length})
        </CardTitle>
        <CardDescription>
          Captured by an agent while working this ticket — review these before approving a change.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2">
          {attachments.map((shot) => (
            <figure key={shot.id} className="flex flex-col gap-1.5">
              <a
                href={`/api/attachments/${shot.id}`}
                target="_blank"
                rel="noreferrer"
                className="block overflow-hidden rounded-lg border border-border transition-colors hover:border-primary"
              >
                {/* Unoptimized: the bytes come from our own API route, not a
                    static asset the image optimizer can fetch at build time. */}
                <Image
                  src={`/api/attachments/${shot.id}`}
                  alt={shot.caption}
                  width={640}
                  height={400}
                  unoptimized
                  className="h-auto w-full bg-muted"
                />
              </a>
              <figcaption className="font-sans text-xs text-muted-foreground">
                {shot.caption} · <RelativeTime value={shot.createdAt} />
              </figcaption>
            </figure>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
