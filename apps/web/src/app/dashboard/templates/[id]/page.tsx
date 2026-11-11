'use client';

import type { TemplateCategory } from '@smsvio/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';

import { TemplateEditor } from '@/components/catalog/template-editor';
import { useCanMessage } from '@/components/shell/shell';
import { useToast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { accountApi, ApiError } from '@/lib/api';
import { catalogApi } from '@/lib/catalog';

export default function TemplatePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const canMessage = useCanMessage();
  const toast = useToast();
  const queryClient = useQueryClient();
  const session = useQuery({ queryKey: ['session'], queryFn: () => accountApi.session() });
  const template = useQuery({
    queryKey: ['template', id],
    queryFn: () => catalogApi.template(id),
  });
  const [draft, setDraft] = useState<{
    name: string;
    category: TemplateCategory;
    language: string;
    body: string;
    samples: Record<string, string>;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const current =
    draft ??
    (template.data === undefined
      ? null
      : {
          name: template.data.name,
          category: template.data.category,
          language: template.data.language,
          body: template.data.body,
          samples: template.data.samples,
        });

  async function save() {
    if (current === null) {
      return;
    }
    setSaving(true);
    try {
      const saved = await catalogApi.updateTemplate(id, {
        ...(current.name.trim() === '' ? {} : { name: current.name.trim() }),
        category: current.category,
        language: current.language,
        body: current.body,
        samples: current.samples,
      });
      setDraft(null);
      toast('Draft saved. Review status was reset.');
      queryClient.setQueryData(['template', id], saved);
      await queryClient.invalidateQueries({ queryKey: ['templates'] });
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Could not save the draft.');
    } finally {
      setSaving(false);
    }
  }

  async function submit() {
    setSaving(true);
    try {
      const saved = await catalogApi.submitTemplate(id);
      setDraft(null);
      toast(saved.status === 'APPROVED' ? 'Template approved.' : 'Submitted for review.');
      queryClient.setQueryData(['template', id], saved);
      await queryClient.invalidateQueries({ queryKey: ['templates'] });
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Could not submit the template.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{template.data?.name ?? 'Template'}</h1>
          {template.data?.rejectionReason === null ||
          template.data?.rejectionReason === undefined ? null : (
            <p className="text-destructive mt-1 text-sm">{template.data.rejectionReason}</p>
          )}
        </div>
        <Button asChild variant="outline">
          <Link href={`/dashboard/templates/${id}/analytics`}>Analytics</Link>
        </Button>
      </div>
      {template.isPending || current === null ? (
        <div className="bg-muted h-64 animate-pulse rounded-2xl" />
      ) : (
        <TemplateEditor
          templateId={id}
          name={current.name}
          category={current.category}
          language={current.language}
          body={current.body}
          samples={current.samples}
          status={template.data?.status}
          locked={!canMessage}
          saving={saving}
          smartEncoding={session.data?.organization?.smartEncoding !== false}
          onChange={setDraft}
          onSave={() => {
            if (canMessage) {
              void save();
            }
          }}
          onSubmit={
            canMessage
              ? () => {
                  void submit();
                }
              : undefined
          }
        />
      )}
    </section>
  );
}
