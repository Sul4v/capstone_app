import { Expert } from '@/types';

interface ExpertBadgeProps {
  expert: Expert;
}

export default function ExpertBadge({ expert }: ExpertBadgeProps) {
  const expertise =
    expert.expertiseAreas && expert.expertiseAreas.length > 0
      ? expert.expertiseAreas.join(', ')
      : 'Software Engineering';

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-left shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-lg text-blue-900">
            {expert.name}
          </div>
          {expert.title ? (
            <div className="text-xs text-blue-600 mt-1 uppercase tracking-wide">
              {expert.title}
            </div>
          ) : null}
        </div>
        <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-800 bg-white/80 border border-blue-100 px-2 py-1 rounded-full">
          <span className="h-2 w-2 rounded-full bg-blue-500" />
          Expert
        </span>
      </div>
      <div className="text-sm text-blue-700 mt-3 leading-relaxed">
        Focus areas: {expertise}
      </div>
      {expert.reasoning ? (
        <p className="text-xs text-blue-500 mt-3 italic">
          {expert.reasoning}
        </p>
      ) : null}
    </div>
  );
}
