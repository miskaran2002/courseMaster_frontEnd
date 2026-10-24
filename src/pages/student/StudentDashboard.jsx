import { useEffect, useState, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { fetchMyEnrollments } from "../../store/slices/enrollmentSlice";
import { Link } from "react-router-dom";
import { getQuizStats } from "../../services/quiz.api";
import { getAssignmentStats } from "../../services/assignment.api";
import { getCourseById } from "../../services/courses.api";

export default function StudentDashboard() {
    const dispatch = useDispatch();
    const { enrollments, loading, error } = useSelector((state) => state.enrollment);
    const { currentCourse } = useSelector((state) => state.courses);

    const [expandedCourse, setExpandedCourse] = useState(null);
    const [courseStats, setCourseStats] = useState({}); // { courseId: { quizStats, assignmentStats, courseData, lessonMap } }
    const [loadingStats, setLoadingStats] = useState({});

    // Cache for lesson title lookups to avoid repeated loops
    const lessonTitleCache = useRef({});

    useEffect(() => {
        dispatch(fetchMyEnrollments());
    }, [dispatch]);

    // Create lesson title lookup map from course data (optimized)
    const createLessonMap = (courseData) => {
        if (!courseData?.syllabus) return {};
        const map = {};
        courseData.syllabus.forEach(module => {
            if (module.lessons) {
                module.lessons.forEach(lesson => {
                    map[String(lesson._id)] = lesson.title;
                });
            }
        });
        return map;
    };

    // Helper function to find lesson title from lessonId (uses cached map)
    const getLessonTitle = (courseId, lessonId) => {
        const cacheKey = `${courseId}_${lessonId}`;
        if (lessonTitleCache.current[cacheKey]) {
            return lessonTitleCache.current[cacheKey];
        }

        const stats = courseStats[courseId];
        if (stats?.lessonMap) {
            const title = stats.lessonMap[String(lessonId)] || "Lesson";
            lessonTitleCache.current[cacheKey] = title;
            return title;
        }
        return "Lesson";
    };

    // Fetch stats for a specific course (optimized)
    const loadCourseStats = async (courseId, forceRefresh = false) => {
        if (courseStats[courseId] && !forceRefresh) return;
        if (loadingStats[courseId]) return;

        setLoadingStats(prev => ({ ...prev, [courseId]: true }));

        try {
            let courseData = courseStats[courseId]?.courseData;

            if (!courseData || forceRefresh) {
                try {
                    if (currentCourse?._id === courseId) {
                        courseData = currentCourse;
                    } else {
                        const res = await getCourseById(courseId);
                        courseData = res.data;
                    }
                } catch (err) {
                    console.error("Failed to fetch course:", err);
                    if (!courseData) {
                        courseData = null;
                    }
                }
            }

            const [quizRes, assignmentRes] = await Promise.all([
                getQuizStats(courseId).catch(err => {
                    console.error("Quiz stats error:", err);
                    return { data: { average: 0, totalQuizzes: 0, submissions: [] } };
                }),
                getAssignmentStats(courseId).catch(err => {
                    console.error("Assignment stats error:", err);
                    return { data: { average: 0, totalAssignments: 0, reviewedCount: 0, submissions: [] } };
                }),
            ]);

            const lessonMap = courseData ? createLessonMap(courseData) : {};

            setCourseStats(prev => ({
                ...prev,
                [courseId]: {
                    quizStats: quizRes.data,
                    assignmentStats: assignmentRes.data,
                    courseData: courseData,
                    lessonMap: lessonMap,
                },
            }));
        } catch (err) {
            console.error("Failed to load course stats:", err);
        } finally {
            setLoadingStats(prev => ({ ...prev, [courseId]: false }));
        }
    };

    const handleExpandCourse = (courseId) => {
        if (expandedCourse === courseId) {
            setExpandedCourse(null);
        } else {
            setExpandedCourse(courseId);
            loadCourseStats(courseId, false);
        }
    };

    const handleRefreshStats = (courseId) => {
        Object.keys(lessonTitleCache.current).forEach(key => {
            if (key.startsWith(`${courseId}_`)) {
                delete lessonTitleCache.current[key];
            }
        });
        setCourseStats(prev => {
            const newStats = { ...prev };
            delete newStats[courseId];
            return newStats;
        });
        loadCourseStats(courseId, true);
    };

    const getCourseProgressPercent = (completedLessonsCount, totalLessonsCount) => {
        if (!totalLessonsCount || totalLessonsCount <= 0) return 0;
        return Math.min(100, Math.round((completedLessonsCount / totalLessonsCount) * 100));
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center min-h-[60vh]">
                <span className="loading loading-spinner loading-lg"></span>
            </div>
        );
    }

    return (
        <div className="container mx-auto px-4 py-4 space-y-4 lg:space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <h1 className="text-2xl sm:text-3xl font-bold">My Courses</h1>
                <Link to="/" className="btn btn-outline btn-sm sm:btn-md w-full sm:w-auto">
                    Browse More Courses
                </Link>
            </div>

            {error && (
                <div className="alert alert-error">
                    <span>{error}</span>
                </div>
            )}

            {(!enrollments || enrollments.length === 0) ? (
                <div className="card bg-base-200">
                    <div className="card-body text-center py-12">
                        <h2 className="card-title justify-center">No courses enrolled yet</h2>
                        <p className="text-base-content/70">
                            Start your learning journey by enrolling in a course
                        </p>
                        <Link to="/" className="btn btn-primary w-fit mx-auto mt-4">
                            Browse Courses
                        </Link>
                    </div>
                </div>
            ) : (
                <div className="space-y-4">
                    {enrollments?.map((enrollment) => {
                        const courseId = enrollment.course?._id;
                        const isExpanded = expandedCourse === courseId;
                        const stats = courseStats[courseId];
                        const isLoading = loadingStats[courseId];

                        // --- FIXED PART START ---
                        // Calculate percentage once to use in both text and progress bar
                        const completedCount = enrollment.progress?.completedLessons?.length || 0;
                        const totalLessons = stats?.courseData?.syllabus?.reduce(
                            (acc, module) => acc + (module.lessons?.length || 0),
                            0
                        ) || 0;
                        
                        // Use calculated percent, fallback to database percent, or default to 0
                        const calculatedPercent = totalLessons > 0 
                            ? getCourseProgressPercent(completedCount, totalLessons) 
                            : enrollment.progress?.percent || 0;
                        // --- FIXED PART END ---

                        return (
                            <div
                                key={enrollment._id}
                                className="card bg-base-100 shadow-md border border-base-300"
                            >
                                <div className="card-body p-4 sm:p-6">
                                    {/* Course Header */}
                                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                                        <div className="flex-1 min-w-0">
                                            <h2 className="card-title text-lg sm:text-xl break-words">
                                                {enrollment.course?.title}
                                            </h2>
                                            <p className="text-xs sm:text-sm text-base-content/70 mt-1">
                                                Instructor: {enrollment.course?.instructorName}
                                            </p>
                                        </div>
                                        <div className="flex gap-2 w-full sm:w-auto">
                                            <button
                                                onClick={() => handleExpandCourse(courseId)}
                                                className="btn btn-sm btn-outline flex-1 sm:flex-none"
                                            >
                                                {isExpanded ? "Hide" : "Details"}
                                            </button>
                                            <Link
                                                to={`/courses/${courseId}/player`}
                                                className="btn btn-sm btn-primary flex-1 sm:flex-none"
                                            >
                                                Continue
                                            </Link>
                                        </div>
                                    </div>

                                    {/* Progress Bar - Enhanced */}
                                    <div className="mt-4 p-4 bg-base-200 rounded-lg">
                                        <div className="flex justify-between items-center mb-3">
                                            <div>
                                                <p className="text-sm font-semibold text-base-content/80">Course Progress</p>
                                                {totalLessons > 0 ? (
                                                    <p className="text-xs text-base-content/70 mt-1">
                                                        {completedCount} of {totalLessons} lessons completed
                                                    </p>
                                                ) : completedCount > 0 ? (
                                                    <p className="text-xs text-base-content/70 mt-1">
                                                        {completedCount} lesson{completedCount !== 1 ? 's' : ''} completed
                                                    </p>
                                                ) : null}
                                            </div>
                                            <div className="text-right">
                                                <p className="text-2xl sm:text-3xl font-bold text-primary">
                                                    {calculatedPercent}%
                                                </p>
                                            </div>
                                        </div>
                                        
                                        {/* FIXED: Uses the consistently calculated percentage instead of relying solely on the DB string/number mismatch */}
                                        <progress
                                            className="progress progress-primary w-full h-4"
                                            value={calculatedPercent}
                                            max="100"
                                        ></progress>
                                        
                                        {isExpanded && stats && (
                                            <div className="flex justify-between items-center mt-3 pt-3 border-t border-base-300 text-xs text-base-content/60">
                                                <span>📚 Course Content</span>
                                                <div className="flex gap-3">
                                                    {stats.quizStats?.totalQuizzes > 0 && <span>❓ {stats.quizStats.totalQuizzes} Quiz{stats.quizStats.totalQuizzes !== 1 ? 'zes' : ''}</span>}
                                                    {stats.assignmentStats?.totalAssignments > 0 && <span>📝 {stats.assignmentStats.totalAssignments} Assignment{stats.assignmentStats.totalAssignments !== 1 ? 's' : ''}</span>}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Expanded Details */}
                                    {isExpanded && (
                                        <div className="mt-6 space-y-4 border-t border-base-300 pt-4">
                                            {isLoading ? (
                                                <div className="flex justify-center py-8">
                                                    <span className="loading loading-spinner"></span>
                                                </div>
                                            ) : stats ? (
                                                <>
                                                    <div className="flex justify-end mb-2">
                                                        <button
                                                            onClick={() => handleRefreshStats(courseId)}
                                                            disabled={isLoading}
                                                            className="btn btn-sm btn-outline btn-circle"
                                                            title="Refresh Stats"
                                                        >
                                                            {isLoading ? <span className="loading loading-spinner loading-xs"></span> : "🔄"}
                                                        </button>
                                                    </div>

                                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                                                        <div className="card bg-primary text-primary-content">
                                                            <div className="card-body p-3 sm:p-4">
                                                                <h3 className="text-xs sm:text-sm font-semibold opacity-80">Quiz Average</h3>
                                                                <p className="text-2xl sm:text-3xl font-bold">{stats.quizStats?.average || 0}%</p>
                                                                <p className="text-xs opacity-70">{stats.quizStats?.totalQuizzes || 0} quiz{stats.quizStats?.totalQuizzes !== 1 ? 'zes' : ''} taken</p>
                                                            </div>
                                                        </div>

                                                        <div className="card bg-secondary text-secondary-content">
                                                            <div className="card-body p-3 sm:p-4">
                                                                <h3 className="text-xs sm:text-sm font-semibold opacity-80">Assignment Average</h3>
                                                                <p className="text-2xl sm:text-3xl font-bold">{stats.assignmentStats?.average || 0}%</p>
                                                                <p className="text-xs opacity-70">{stats.assignmentStats?.reviewedCount || 0} of {stats.assignmentStats?.totalAssignments || 0} reviewed</p>
                                                            </div>
                                                        </div>

                                                        <div className="card bg-accent text-accent-content">
                                                            <div className="card-body p-3 sm:p-4">
                                                                <h3 className="text-xs sm:text-sm font-semibold opacity-80">Overall Grade</h3>
                                                                <p className="text-2xl sm:text-3xl font-bold">
                                                                    {(() => {
                                                                        const quizAvg = stats.quizStats?.average || 0;
                                                                        const assignAvg = stats.assignmentStats?.average || 0;
                                                                        const quizCount = stats.quizStats?.totalQuizzes || 0;
                                                                        const assignCount = stats.assignmentStats?.reviewedCount || 0;
                                                                        const total = quizCount + assignCount;
                                                                        if (total === 0) return "N/A";
                                                                        const overall = Math.round((quizAvg * quizCount + assignAvg * assignCount) / total);
                                                                        return `${overall}%`;
                                                                    })()}
                                                                </p>
                                                                <p className="text-xs opacity-70">Weighted average</p>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Quiz Marks */}
                                                    {stats.quizStats?.submissions && stats.quizStats.submissions.length > 0 ? (
                                                        <div className="card bg-base-200">
                                                            <div className="card-body p-3 sm:p-4 sm:p-6">
                                                                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 mb-4">
                                                                    <h3 className="card-title text-base sm:text-lg">📝 Quiz Marks</h3>
                                                                    <span className="badge badge-primary badge-sm sm:badge-lg">
                                                                        {stats.quizStats.submissions.length} Quiz{stats.quizStats.submissions.length !== 1 ? 'zes' : ''}
                                                                    </span>
                                                                </div>
                                                                <div className="space-y-2">
                                                                    {stats.quizStats.submissions.map((quiz, idx) => {
                                                                        const lessonTitle = getLessonTitle(courseId, quiz.lessonId);
                                                                        const submittedDate = quiz.submittedAt ? new Date(quiz.submittedAt) : null;
                                                                        const dateStr = submittedDate ? submittedDate.toLocaleDateString() : 'N/A';
                                                                        const timeStr = submittedDate ? submittedDate.toLocaleTimeString() : '';

                                                                        return (
                                                                            <div key={quiz._id || idx} className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 sm:gap-0 p-4 bg-base-100 rounded-lg shadow-sm hover:shadow-md transition">
                                                                                <div className="flex-1 min-w-0">
                                                                                    <p className="font-semibold text-sm sm:text-base break-words">{lessonTitle}</p>
                                                                                    <p className="text-xs sm:text-sm text-base-content/70 mt-1">{quiz.score} out of {quiz.total} questions correct</p>
                                                                                    {submittedDate && <p className="text-xs text-base-content/50 mt-1">📅 Submitted: {dateStr} at {timeStr}</p>}
                                                                                </div>
                                                                                <div className="text-left sm:text-right">
                                                                                    <p className={`text-2xl sm:text-3xl font-bold ${quiz.percent >= 70 ? 'text-success' : quiz.percent >= 50 ? 'text-warning' : 'text-error'}`}>{quiz.percent}%</p>
                                                                                    <p className="text-xs text-base-content/60 mt-1">{quiz.percent >= 70 ? 'Excellent!' : quiz.percent >= 50 ? 'Good!' : 'Keep practicing!'}</p>
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="alert alert-info">
                                                            <span>📝 No quiz submissions yet. Complete quizzes in the course to see your marks here.</span>
                                                        </div>
                                                    )}

                                                    {/* Assignment Marks */}
                                                    {stats.assignmentStats?.submissions && stats.assignmentStats.submissions.length > 0 && (
                                                        <div className="card bg-base-200">
                                                            <div className="card-body p-3 sm:p-4 sm:p-6">
                                                                <h3 className="card-title text-base sm:text-lg mb-3 sm:mb-4">📄 Assignment Marks</h3>
                                                                <div className="space-y-3">
                                                                    {stats.assignmentStats.submissions.map((assignment, idx) => {
                                                                        const lessonTitle = getLessonTitle(courseId, assignment.lessonId);
                                                                        const submittedDate = assignment.submittedAt ? new Date(assignment.submittedAt) : null;
                                                                        const reviewedDate = assignment.reviewedAt ? new Date(assignment.reviewedAt) : null;

                                                                        return (
                                                                            <div key={assignment._id || idx} className="card bg-base-100">
                                                                                <div className="card-body p-3 sm:p-4">
                                                                                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 sm:gap-0 mb-2">
                                                                                        <div className="flex-1 min-w-0">
                                                                                            <p className="font-semibold text-sm sm:text-base break-words">{lessonTitle}</p>
                                                                                            {submittedDate && <p className="text-xs sm:text-sm text-base-content/70 mt-1">Submitted: {submittedDate.toLocaleDateString()}</p>}
                                                                                            {assignment.status === "reviewed" && reviewedDate && <p className="text-xs sm:text-sm text-base-content/70">Reviewed: {reviewedDate.toLocaleDateString()}</p>}
                                                                                        </div>
                                                                                        <div className="text-left sm:text-right">
                                                                                            <span className={`badge badge-sm ${assignment.status === "reviewed" ? "badge-success" : "badge-warning"}`}>{assignment.status === "reviewed" ? "Reviewed" : "Pending"}</span>
                                                                                            {assignment.grade !== null && assignment.grade !== undefined && (
                                                                                                <p className={`text-xl sm:text-2xl font-bold mt-2 ${assignment.grade >= 70 ? 'text-success' : assignment.grade >= 50 ? 'text-warning' : 'text-error'}`}>{assignment.grade}%</p>
                                                                                            )}
                                                                                        </div>
                                                                                    </div>
                                                                                    {assignment.answerType === "link" ? (
                                                                                        <div className="mt-2">
                                                                                            <p className="text-sm font-semibold">Submission:</p>
                                                                                            <a href={assignment.answer} target="_blank" rel="noopener noreferrer" className="text-primary text-sm hover:underline break-all">{assignment.answer}</a>
                                                                                        </div>
                                                                                    ) : (
                                                                                        <div className="mt-2">
                                                                                            <p className="text-sm font-semibold">Submission:</p>
                                                                                            <p className="text-sm text-base-content/80 bg-base-200 p-2 rounded mt-1">{assignment.answer}</p>
                                                                                        </div>
                                                                                    )}
                                                                                    {assignment.reviewNotes && (
                                                                                        <div className="mt-3 p-3 bg-info/10 border border-info/20 rounded">
                                                                                            <p className="text-sm font-semibold text-info mb-1">📝 Feedback from {assignment.reviewer?.name || "Admin"}:</p>
                                                                                            <p className="text-sm">{assignment.reviewNotes}</p>
                                                                                        </div>
                                                                                    )}
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )}

                                                    {(!stats.assignmentStats?.submissions || stats.assignmentStats.submissions.length === 0) && (
                                                        <div className="alert alert-info">
                                                            <span>No assignment submissions yet. Submit assignments in the course to see your marks and feedback here.</span>
                                                        </div>
                                                    )}
                                                </>
                                            ) : (
                                                <div className="text-center py-4 text-base-content/70">
                                                    Click "View Details" to load statistics
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}