using AITestPilot.Domain.Common;

namespace AITestPilot.Domain.Testing;

public sealed class TestRunCase : WorkspaceScopedEntity
{
    public Guid TestRunId { get; private set; }
    public Guid TestCaseId { get; private set; }
    public int Sequence { get; private set; }
    public string TestCaseNumberSnapshot { get; private set; } = string.Empty;
    public string TitleSnapshot { get; private set; } = string.Empty;
    public int DefinitionVersionSnapshot { get; private set; }
    public TestDefinition DefinitionSnapshot { get; private set; } = new(1, [], []);

    private TestRunCase()
    {
    }

    public TestRunCase(
        Guid workspaceId,
        Guid testRunId,
        TestCase testCase,
        int sequence) : base(workspaceId)
    {
        if (testRunId == Guid.Empty) throw new ArgumentException("TestRunId is required.", nameof(testRunId));
        if (testCase.Id == Guid.Empty) throw new ArgumentException("TestCase must be persisted or assigned an Id.", nameof(testCase));
        if (testCase.WorkspaceId != workspaceId) throw new InvalidOperationException("TestCase belongs to another workspace.");
        if (testCase.Status != TestCaseStatus.Approved) throw new InvalidOperationException("Only approved test cases can be queued for execution.");
        if (sequence <= 0) throw new ArgumentOutOfRangeException(nameof(sequence));

        TestRunId = testRunId;
        TestCaseId = testCase.Id;
        Sequence = sequence;
        TestCaseNumberSnapshot = testCase.TestCaseNumber;
        TitleSnapshot = testCase.Title;
        DefinitionVersionSnapshot = testCase.DefinitionVersion;
        DefinitionSnapshot = testCase.Definition;
    }
}
