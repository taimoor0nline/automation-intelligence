using AITestPilot.Application.Abstractions;

namespace AITestPilot.Infrastructure.Community;

public static class CommunityDefaults
{
    public static readonly Guid LocalWorkspaceId = Guid.Parse("00000000-0000-0000-0000-000000000001");
    public const string LocalWorkspaceCode = "LOCAL";
    public const string LocalWorkspaceName = "Local Community Workspace";
}

public sealed class CommunityWorkspaceContext : IWorkspaceContext
{
    public Guid WorkspaceId => CommunityDefaults.LocalWorkspaceId;
}
