using AITestPilot.Application.Abstractions;
using AITestPilot.Domain.Projects;

namespace AITestPilot.Application.Projects.RegisterProject;

public sealed class RegisterProjectCommandHandler(
    IWorkspaceContext workspaceContext,
    IProjectCategoryRepository categoryRepository,
    IProjectRepository projectRepository,
    IUnitOfWork unitOfWork)
    : ICommandHandler<RegisterProjectCommand, Guid>
{
    public async Task<Guid> HandleAsync(RegisterProjectCommand command, CancellationToken cancellationToken)
    {
        var workspaceId = workspaceContext.WorkspaceId;
        var category = await categoryRepository.GetByIdAsync(workspaceId, command.ProjectCategoryId, cancellationToken)
            ?? throw new InvalidOperationException("Project category was not found in the current workspace.");
        if (!category.IsActive) throw new InvalidOperationException("Project category is inactive.");

        if (await projectRepository.CodeExistsAsync(workspaceId, command.Code, cancellationToken))
            throw new InvalidOperationException($"Project code '{command.Code}' already exists in this workspace.");

        var project = new Project(
            workspaceId,
            category.Id,
            command.Code,
            command.Name,
            command.ShortDescription,
            command.DetailedDescription,
            command.ApplicationType,
            command.TechnologyStack,
            command.RepositoryUrl,
            command.DefaultBranch,
            command.BusinessOwner,
            command.TechnicalOwner);

        await projectRepository.AddAsync(project, cancellationToken);
        await unitOfWork.SaveChangesAsync(cancellationToken);
        return project.Id;
    }
}
