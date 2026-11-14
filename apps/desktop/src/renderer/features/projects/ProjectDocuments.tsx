import DocumentWorkspace from '../../ui/DocumentLibrary';

export default function ProjectDocuments({
  projectId,
  initialDocumentId,
  externalBlocked,
  onDirty,
}: {
  projectId: string;
  initialDocumentId?: string;
  externalBlocked: boolean;
  onDirty(value: boolean): void;
}) {
  return (
    <DocumentWorkspace
      projectId={projectId}
      initialDocumentId={initialDocumentId}
      externalBlocked={externalBlocked}
      onDirty={onDirty}
      onOpen={() => {}}
    />
  );
}
