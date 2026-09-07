import { Card, Button } from "../../components/common.jsx";

export default function StepDone({ navigate }) {
  return (
    <Card className="p-6 text-center">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">You're set up</h2>
      <p className="mx-auto mt-2 max-w-prose text-sm text-slate-500 dark:text-slate-400">
        Nothing has actually been created on Docker yet: review the plan and apply it to bring the
        containers up.
      </p>
      <div className="mt-5 flex justify-center gap-2">
        <Button tone="accent" onClick={() => navigate("/stack")}>
          Review the stack plan
        </Button>
      </div>
    </Card>
  );
}
