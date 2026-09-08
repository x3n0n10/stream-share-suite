import { Card, Button } from "../../components/common.jsx";

export default function StepDone({ navigate, onBack }) {
  return (
    <Card className="p-6 text-center">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">You're set up</h2>
      <p className="mx-auto mt-2 max-w-prose text-sm text-slate-500 dark:text-slate-400">
        Nothing has actually been created on Docker yet: review the plan and apply it to bring the
        containers up.
      </p>
      <div className="mt-5 flex items-center justify-center gap-2 border-t border-slate-200 pt-5 dark:border-slate-800">
        {onBack && (
          <Button tone="ghost" onClick={onBack}>
            Back
          </Button>
        )}
        <Button tone="accent" onClick={() => navigate("/stack")}>
          Review the stack plan
        </Button>
      </div>
    </Card>
  );
}
