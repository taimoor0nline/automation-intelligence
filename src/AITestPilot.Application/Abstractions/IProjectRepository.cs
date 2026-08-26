using AITestPilot.Domain.Projects;

namespace AITestPilot.Application.Abstractions;

public interface IProjectRepository
{
    Task<Project?> GetByIdAsync(Guid workspaceId, Guid projectId, CancellationToken cancellationToken);
    Task<IReadOnlyList<Project>> ListAsync(Guid workspaceId, CancellationToken cancellationToken);
    Task<bool> CodeExistsAsync(Guid workspaceId, string code, CancellationToken cancellationToken);
    Task AddAsync(Project project, CancellationToken cancellationToken);
}
