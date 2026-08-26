using AITestPilot.Application.Abstractions;
using AITestPilot.Infrastructure.Community;
using AITestPilot.Infrastructure.Execution;
using AITestPilot.Infrastructure.Identity;
using AITestPilot.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace AITestPilot.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddAITestPilotInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("AITestPilot")
            ?? configuration["AITESTPILOT_POSTGRES"]
            ?? "Host=localhost;Port=5432;Database=aitestpilot;Username=aitestpilot;Password=aitestpilot";

        services.AddDbContext<AITestPilotDbContext>(options =>
            options.UseNpgsql(connectionString));

        services.AddIdentityCore<ApplicationUser>(options =>
            {
                options.User.RequireUniqueEmail = true;
                options.Password.RequiredLength = 10;
                options.Password.RequireDigit = true;
                options.Password.RequireLowercase = true;
                options.Password.RequireUppercase = true;
                options.Password.RequireNonAlphanumeric = false;
                options.Lockout.MaxFailedAccessAttempts = 5;
            })
            .AddRoles<IdentityRole<Guid>>()
            .AddEntityFrameworkStores<AITestPilotDbContext>()
            .AddSignInManager();

        services.AddSingleton<IWorkspaceContext, CommunityWorkspaceContext>();
        services.AddScoped<IUnitOfWork, EfUnitOfWork>();
        services.AddScoped<IProjectRepository, EfProjectRepository>();
        services.AddScoped<IProjectCategoryRepository, EfProjectCategoryRepository>();
        services.AddScoped<IProjectEnvironmentRepository, EfProjectEnvironmentRepository>();
        services.AddScoped<ITestCaseRepository, EfTestCaseRepository>();
        services.AddScoped<ITestRunRepository, EfTestRunRepository>();
        services.AddScoped<ITestRunExecutionStore, EfTestRunExecutionStore>();
        services.AddScoped<IExecutionQueue, PostgresExecutionQueue>();

        return services;
    }
}
