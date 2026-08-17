export interface WorkflowViewToken {
  conversationId: string | null;
  revision: number;
}

/**
 * Invalidates async workflow reads whenever the selected conversation changes
 * (including A -> B -> A). This prevents an older request from restoring a
 * workflow run that no longer owns the right-hand panel.
 */
export class WorkflowViewGuard {
  private conversationId: string | null = null;
  private revision = 0;

  select(conversationId: string | null): WorkflowViewToken {
    this.conversationId = conversationId;
    this.revision += 1;
    return this.snapshot();
  }

  snapshot(): WorkflowViewToken {
    return {
      conversationId: this.conversationId,
      revision: this.revision
    };
  }

  isCurrent(token: WorkflowViewToken): boolean {
    return (
      token.revision === this.revision &&
      token.conversationId === this.conversationId
    );
  }
}
