import SwiftUI

struct LotView: View {
    @EnvironmentObject private var store: ThinkLotStore
    @State private var title = ""
    @State private var tab = 0
    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("View", selection: $tab) {
                    Text("Ideas").tag(0); Text("Board").tag(1); Text("Review").tag(2)
                }.pickerStyle(.segmented).padding()
                if tab == 2 { ReviewView() }
                else {
                    filters
                    if let page = store.page {
                        if page.truncated {
                            Text("Showing \(page.ideas.count) of \(Int(page.total)) matches. Narrow search or filters to find older ideas.")
                                .font(.caption).padding().accessibilityLabel("Results are limited. Narrow search to find older ideas.")
                        }
                        if tab == 1 { board }
                        else { list }
                    } else {
                        VStack { ProgressView("Loading ideas…"); Button("Retry") { store.load() } }.frame(maxHeight: .infinity)
                    }
                }
            }
            .navigationTitle("ThinkLot")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Text(store.connection).font(.caption).foregroundStyle(.secondary) }
                ToolbarItem(placement: .topBarTrailing) { Button("Sign out") { Task { await store.signOut() } }.disabled(store.busy) }
            }
            .safeAreaInset(edge: .bottom) {
                HStack {
                    TextField("Capture an idea…", text: $title, axis: .vertical).lineLimit(1...3)
                    Button("Add", systemImage: "plus") {
                        Task { if await store.mutate("ideas:capture", ["title": title, "source": "typed"]) { title = "" } }
                    }.disabled(store.busy || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }.padding().background(.bar)
            }
            .task(id: store.filterKey) {
                do { try await Task.sleep(for: .milliseconds(250)); store.load() } catch { }
            }
        }
    }
    private var filters: some View {
        VStack {
            TextField("Search titles, notes, and tags", text: $store.search).textFieldStyle(.roundedBorder)
            HStack {
                Picker("Status", selection: $store.status) {
                    Text("All stages").tag(Optional<Lifecycle>.none)
                    ForEach(Lifecycle.allCases) { Text($0.label).tag(Optional($0)) }
                }
                TextField("Tag filter", text: $store.tag).textInputAutocapitalization(.never).autocorrectionDisabled().textFieldStyle(.roundedBorder)
            }
            HStack {
                Toggle("Archive", isOn: $store.archived)
                Toggle("Favorites", isOn: $store.favorites)
            }
            Toggle("Sort loaded ideas by priority", isOn: $store.prioritySort).font(.caption)
        }.padding(.horizontal).padding(.bottom)
    }
    private var list: some View {
        List {
            if store.visibleIdeas.isEmpty { Text("No ideas match these filters.").foregroundStyle(.secondary) }
            ForEach(store.visibleIdeas) { idea in
                NavigationLink { IdeaDetailView(ideaId: idea.id) } label: { IdeaRow(idea: idea) }
            }
        }.listStyle(.plain).refreshable { store.load() }
    }
    private var board: some View {
        ScrollView(.horizontal) {
            HStack(alignment: .top, spacing: 16) {
                ForEach(Lifecycle.allCases) { status in
                    VStack(alignment: .leading) {
                        Text(status.label).font(.headline)
                        ForEach(store.visibleIdeas.filter { $0.status == status }) { idea in
                            NavigationLink { IdeaDetailView(ideaId: idea.id) } label: {
                                IdeaRow(idea: idea).padding().frame(maxWidth: .infinity, alignment: .leading).background(.regularMaterial).clipShape(RoundedRectangle(cornerRadius: 14))
                            }.buttonStyle(.plain).draggable(idea.id)
                        }
                    }.frame(width: 260).padding()
                    .dropDestination(for: String.self) { ids, _ in
                        guard !store.busy, let id = ids.first, store.visibleIdeas.contains(where: { $0.id == id }) else { return false }
                        Task { await store.mutate("ideas:setStatus", ["ideaId": id, "status": status.rawValue]) }
                        return true
                    }
                }
            }
        }
    }
}

struct IdeaRow: View {
    let idea: Idea
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(idea.plate).font(.caption.monospaced()).foregroundStyle(.secondary)
                Spacer()
                if idea.favorite { Image(systemName: "star.fill").foregroundStyle(.orange).accessibilityLabel("Favorite") }
            }
            Text(idea.title).font(.headline)
            if let preview = idea.preview { Text(preview).lineLimit(2).font(.subheadline).foregroundStyle(.secondary) }
            Text("\(idea.status.label) · \(idea.tags.joined(separator: ", "))").font(.caption).foregroundStyle(.secondary)
            if let priority = idea.priority { Text("Priority \(priority, specifier: "%.1f")").font(.caption.bold()) }
        }
    }
}

struct ReviewView: View {
    @EnvironmentObject private var store: ThinkLotStore
    var body: some View {
        List {
            if let review = store.review {
                if review.truncated { Text("Showing \(review.items.count) of \(Int(review.total)) queued ideas.").font(.caption) }
                Text("The server reviews a bounded scan of 500 ideas and returns up to 40 items.").font(.caption).foregroundStyle(.secondary)
                if review.items.isEmpty { Text("Your review queue is clear.") }
                ForEach(review.items) { item in
                    VStack(alignment: .leading, spacing: 10) {
                        NavigationLink(item.title) { IdeaDetailView(ideaId: item.id) }.font(.headline)
                        Text(item.reasons.map { $0.replacingOccurrences(of: "_", with: " ").capitalized }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                        HStack {
                            Button("Ready") { Task { await store.mutate("ideas:setStatus", ["ideaId": item.id, "status": "ready"]) } }
                            Menu("Snooze") {
                                ForEach([1, 7, 30], id: \.self) { days in
                                    Button("\(days) days") { Task { await store.mutate("review:snooze", ["ideaId": item.id, "days": Double(days)]) } }
                                }
                            }
                            Button("Archive") { Task { await store.mutate("ideas:setArchived", ["ideaId": item.id, "archived": true]) } }
                        }.buttonStyle(.bordered).disabled(store.busy)
                    }.padding(.vertical, 6)
                }
            } else { ProgressView("Loading review…"); Button("Retry") { store.load() } }
        }.refreshable { store.load() }
    }
}
